import 'dotenv/config'
import { join, resolve, extname, basename } from 'node:path';
import { readdir, readFile, statSync, writeFile, existsSync, readFileSync } from 'node:fs';
import { PDFLoader } from "./pdfLoader";
import postgres from 'postgres';
import { MultiFileLoader } from 'langchain/document_loaders/fs/multi_file';
import { MarkdownTextSplitter, RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document, DocumentInput } from "@langchain/core/documents";
import { getModel, getVectorStore } from '../server/utils/ai';
// import { generateAnswerFromDocument } from '../server/utils/rag';
import { ChatPromptTemplate, MessagesPlaceholder, PromptTemplate } from '@langchain/core/prompts';
import { RunnablePassthrough, RunnableSequence } from '@langchain/core/runnables';
import { InMemoryStore } from "@langchain/core/stores";
import { ParentDocumentRetriever } from "langchain/retrievers/parent_document";
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { inspect } from 'node:util';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { formatDocumentsAsString } from 'langchain/util/document';
import { ChatMessageHistory } from 'langchain/stores/message/in_memory';
import { generateAnswerFromDocument, getRetriever } from '../server/utils/rag';
import { spawn } from 'node:child_process';
import { TextLoader } from "langchain/document_loaders/fs/text";
import supabase from '../server/utils/supabase';
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio';

const model = getModel('google')

const idKey = 'doc_id'

const convertToMarkdown = async (command: string) => {
    const sourceDirectory = './pdfs_to_convert';
    const pythonScript = 'markdown.py';

    const scriptPath = join(__dirname, pythonScript);

    // Pass the source and output directories as arguments
    const pythonProcess = spawn('python', [scriptPath, sourceDirectory]);

    pythonProcess.stdout.on('data', (data) => {
        console.log(`Python stdout: ${data}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python stderr: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`Python process exited with code ${code}`);
        if (code !== 0) {
            console.error('PDF conversion failed.');
        } else {
            console.log('PDF conversion completed successfully.');
        }
    });
}
const createTable = async () => {

    const sql = postgres(process.env.SUPABASE_PG_URL as string, {
        ssl: {
            rejectUnauthorized: false
        }
    });

    const createQuery = `
        -- First, ensure the 'pgvector' extension is installed and enabled.
        -- If not, you may need to install it on your system and then run this command:
        CREATE EXTENSION IF NOT EXISTS vector;

        -- This command creates a new table named 'vector_store' to hold your vector embeddings.
        CREATE TABLE IF NOT EXISTS documents_summary (
            id BIGSERIAL PRIMARY KEY,
            -- The VECTOR data type is provided by the pgvector extension.
            -- The number in parentheses is the dimension of your embeddings (e.g., 1536 for OpenAI's ada-002 model).
            embedding VECTOR(1536), 
            
            -- An optional column to store the original text or metadata associated with the embedding.
            content TEXT,
            metadata JSONB
        );

        -- Creating an index on the embedding column is crucial for fast similarity searches.
        -- This GIST index is highly recommended for large datasets and efficient lookups.
        -- CREATE INDEX ON documents_summary USING GIST (embedding);
        CREATE INDEX ON documents_summary USING hnsw (embedding vector_cosine_ops);

        -- Create a function to search for documents
        create function match_documents (
            query_embedding vector(1536),
            match_count int default null,
            filter jsonb DEFAULT '{}'
            ) returns table (
            id bigint,
            content text,
            metadata jsonb,
            similarity float
        )
        
        language plpgsql
        as $$
        #variable_conflict use_column
        begin
        return query
        select
            id,
            content,
            metadata,
            1 - (documents_summary.embedding <=> query_embedding) as similarity
        from documents_summary
        where metadata @> filter
        order by documents_summary.embedding <=> query_embedding
        limit match_count;
        end;
        $$;
        `

    try {
        const query = await sql`${createQuery}`

        console.log(query)

    } catch (error) {
        console.log(error)

    }
}

const listDocuments = (folderPath: string): Promise<string[]> => {
    return new Promise((resolve, reject) => {
        readdir(folderPath, (err, files) => {
            let result: string[] = []

            if (err) {
                console.error("Error reading directory:", err);
                return;
            }

            files
                .filter(file => extname(file).toLowerCase() === ".md")
                .map(file => join(folderPath, file))
                .forEach(file => result.push(file))

            console.warn('list files found...', result)

            resolve(result)
        })
    })
}

function isValidHttpURL(file: string) {
    let url;

    try {
        url = new URL(file);
    } catch (_) {
        return false;
    }

    return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * Loads a document from a given file path or URL.
 * Supports PDF, MD, DOCX, and CSV file extensions.
 * If the file path is a URL, it will be loaded using the CheerioWebBaseLoader.
 * If the file path is a local file, it will be loaded using the appropriate loader
 * based on the file extension.
 * @throws {Error} If the file extension is not supported.
 * @param {string} file - The file path or URL to load.
 * @returns {Promise<Document[]>} A promise that resolves to an array of loaded documents.
 */
export const loadDocument = async (file: string): Promise<Document[]> => {
    let loader;

    console.log('loading document...')


    if (isValidHttpURL(file)) {
        loader = new CheerioWebBaseLoader(file)
    } else {
        const extension = extname(file);

        switch (extension) {
            case '.pdf':
                loader = new PDFLoader(file, {
                    parsedItemSeparator: ' ',
                });
                break;
            case '.md':
                loader = new TextLoader(file);
                break;
            // case '.docx':
            //     loader = new TextLoader(file);
            //     break;
            // case '.csv':
            //     loader = new TextLoader(file);
            //     break;
            default:
                throw new Error(`Unsupported file extension: ${extension}`);
        }
    }

    return await loader.load();
}

/**
 * Returns a pair of splitters for the given file extension.
 * The parent splitter is used to split the document into chunks.
 * The child splitter is used to split the chunks into smaller sub-chunks.
 * The parent splitter is overridden for markdown files to use the MarkdownTextSplitter.
 * For other file extensions, the RecursiveCharacterTextSplitter is used.
 * @param file The file path with extension
 * @returns An object with two properties: splitter and childSplitter
 */
export const documentSplitter = (file: string) => {
    const extension = extname(file);

    let splitter: RecursiveCharacterTextSplitter

    const chunkOptions = {
        chunkOverlap: 10,
        chunkSize: 768 * 8,
    };

    if (extension === '.md') {
        splitter = new MarkdownTextSplitter(chunkOptions)
    } else {
        splitter = new RecursiveCharacterTextSplitter(chunkOptions)

    }

    return splitter
}

/**
 * A function that takes an array of documents as parameters and returns a promise that resolves to an object 
 * with the following properties: title, summary, context, and source. 
 * It uses the Google AI model to summarize the document.
 * @param documents - A slice of array from Document instances.
 * @returns A promise that resolves to an object with the following properties: title, summary, context, and source.
 */
export const getDocumentSummary = async (docs: Document[], ids: { fileId: string, docIds: string[] }) => {
    console.log('getting documents summary...')

    const queryOutput = z.object({
        title: z.string().describe("Title of the document"),
        summary: z.string().describe("Summary of the document"),
        attachment: z.optional(z.object({
            formulas: z.optional(z.object({
                name: z.string().describe("Formula name"),
                description: z.string().describe("Description of the formula"),
                formula: z.string().describe("Formula"),
                formula_variables: z.string().describe("Formula variables description"),
                lines: z.object({
                    from: z.number().describe("Start line number"),
                    to: z.number().describe("End line number"),
                })
                    .describe("Line number of the formula to insert later")
            })).describe("Formulas"),
            images: z.optional(z.object({
                name: z.string().describe("image name"),
                description: z.string().describe("Description of the image"),
                image_link: z.string().describe("image"),
                lines: z.object({
                    from: z.number().describe("Start line number"),
                    to: z.number().describe("End line number"),
                })
                    .describe("Line number of the image to insert later")
            })),
            charts: z.optional(z.object({
                name: z.string().describe("image name"),
                description: z.string().describe("Description of the image"),
                image_link: z.string().describe("image"),
                lines: z.object({
                    from: z.number().describe("Start line number"),
                    to: z.number().describe("End line number"),
                })
                    .describe("Line number of the image to insert later")
            })),
        })),
        loc: z.object({
            pageNumber: z.object({
                from: z.number().describe("Start page number"),
                to: z.number().describe("End page number"),
            }).describe("Page range number"),
            lines: z.object({
                from: z.number().describe("Start line number"),
                to: z.number().describe("End line number"),
            })
                .describe("Line number")
        }).describe("Location of the summary"),
    });

    const prompt = PromptTemplate.fromTemplate(`
            You're a helpful AI assistant. 

            - Summarize in indonesian language the following document with no more than 5 sentence
            - Give context with no more than 5 words what is it about based on the content,
            - if any image or formula is in the document remove from content and move it to attachment along with its properties and line number
            - and provide additional information from metadata like the title of the document, filename information

            Content:
            {content}
            `)

    const chain = RunnableSequence.from([
        {
            content: (doc: Document) => doc.pageContent,
            metadata: (doc: Document) => doc.metadata,
        },
        prompt,
        model.withStructuredOutput(queryOutput),
    ]);

    const summaries = await chain.batch(docs, {
        maxConcurrency: 1,
    });

    console.log('successfully getting documents summary...')

    return summaries.map((summaryMap, i) => {
        const { summary, loc, title, attachment } = summaryMap

        const content = docs[i].pageContent

        return new Document({
            pageContent: content,
            metadata: {
                summary,
                loc,
                title,
                attachment,
                doc_id: ids.docIds[i],
                source_id: ids.fileId
            },
        });
    });


}

const checkFromFile = async (docs: Document[], ids: { fileId: string, docIds: string[] }, filepath: string) => {
    const dir = process.env.DOCUMENT_PATH as string

    const filename = `${basename(filepath, extname(filepath))}_summary.json`

    const path = join(dir, filename)

    let summaries: Document[]

    if (existsSync(path)) {
        console.log('file json exists...', path)

        let json = JSON.parse(readFileSync(path, 'utf-8'))

        if (docs.length !== json.length) {
            console.log('file json exists but document length is different...', path)
            summaries = await getDocumentSummary(docs, ids)

            const content = JSON.stringify(summaries)

            writeFile(path, content, err => {
                console.log('rewriting file...', path)
                if (err) {
                    console.log(err, content)
                }
            })
        } else {
            console.log('retrieve exisiting file...', path)
            summaries = json.map((doc: DocumentInput<Record<string, any>>) => new Document(doc))
        }

    } else {
        console.log('file doesnt exists', path)
        summaries = await getDocumentSummary(docs, ids)

        const content = JSON.stringify(summaries)

        writeFile(path, content, err => {
            console.log('writing new file', path)
            if (err) {
                console.log(err, content)
            }
        })

    }

    return summaries
}

/**
 * Sets the vector store with the given file.
 * If the file exists in the database, it will use the existing data.
 * If the file does not exist in the database, it will create new data and add it to the vector store.
 * @param {string} file - The file path with extension
 * @returns {Promise<SupabaseVectorStore>} - A promise that resolves to a SupabaseVectorStore instance
 */
export const setVectorStore = async (file: string) => {
    const vectorstore = getVectorStore()

    const documents = await loadDocument(file)

    const splitter = documentSplitter(file)

    const docs = await splitter.splitDocuments(documents)

    const filename = basename(file, extname(file))

    console.log('getting ids from database...', filename)

    const { data, error } = await supabase
        .from('documents')
        .select()
        .ilike('filename', `%${filename}%`)

    if (error) {
        console.error('Failed to get documents from database', error)
    }

    if (data?.length) {
        console.log('file exists in database...', filename)
    } else {
        console.log('file not exists in database...')

        const ids = {
            docIds: docs.map((_, i) => `${filename}_${i}`),
            fileId: `${filename}_${uuid()}`
        }

        const summaries = await checkFromFile(docs, ids, file)

        const metadata = getBasicMetadata(file)

        console.log('insert new data to database...', filename)
        await storeToDB(docs.slice(0, 5), {
            ...ids,
            ...metadata
        })

        console.log('adding data to vector store...', filename)

        await vectorstore.addDocuments(summaries);

    }
    console.log('success adding to vector store...', filename)

    return vectorstore
}


const getBasicMetadata = (filePath: string) => {
    console.log('geting meta data...', filePath)
    try {
        const stats = statSync(filePath);

        return {
            filename: basename(filePath),
            extension: extname(filePath),
            filePath,
            filesize: stats.size, // Size in bytes
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime,
        };
    } catch (error) {
        console.error(`Error getting file stats: ${error.message}`);
        return null;
    }
};

const storeToDB = async (data: Document[], metadata) => {
    const queryOutput = z.object({
        title: z.string().describe("Title of the document"),
        summary: z.string().describe("Summary of the document"),
    });

    const { fileId, filename, docIds } = metadata


    console.log('generating file summary ...', filename)

    const prompt = PromptTemplate.fromTemplate(`
            You're a helpful AI assistant. 

            - Summarize in indonesian language the following document with no more than 5 sentence
            - Give context with no more than 5 words what is it about based on the content,
            - and provide additional information from metadata like the title of the document, filename information

            Content:
            {content}
            `)

    const content = formatDocumentsAsString(data)

    const { title, summary } = await prompt.pipe(model.withStructuredOutput(queryOutput)).invoke({ content })

    const { error } = await supabase
        .from('documents')
        .insert({
            uuid: fileId,
            title,
            filename,
            metadata: {
                docIds,
                summary,
                ...metadata
            }
        })

    console.log('success creating new data...', filename)

    if (error) {
        console.log('error', error)
    }
}

async function run() {
    try {
        // await createTable()

        // const folderpath = resolve(process.env.DOCUMENT_PATH as string);

        // const docs = await listDocuments(folderpath)

        // for (let doc of docs) {
        //     console.warn('initiating document:', doc)
        //     await setVectorStore(doc)
        // }

        // const path = `${process.env.DOCUMENT_PATH}/rispam.md`

        // await setVectorStore(path)

        // const retriever = getRetriever()

        // const result = await retriever.invoke('jumlah sampah dan jumlah orang di semarang')

        // console.log(result.length, inspect(result, false, null, true))

        // const model = getModel('google')

        // const summaries = await summarize(split)

        // const retriever = getRetriever()

        // await retriever.addDocuments(docs);

        const generate = generateAnswerFromDocument()

        const result = await generate.invoke('skenario dan proyeksi pengurangan sampah yang optimal')

        console.log(inspect(result, false, null, true))

    } catch (error) {
        console.error('error database', error)
    }
}

run()