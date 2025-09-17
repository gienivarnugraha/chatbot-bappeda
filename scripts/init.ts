import 'dotenv/config'
import { join, resolve, extname, basename } from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs';
import { PDFLoader } from "./pdfLoader";
import postgres from 'postgres';
import { MultiFileLoader } from 'langchain/document_loaders/fs/multi_file';
import { MarkdownTextSplitter, RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "@langchain/core/documents";
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
                .filter(file => extname(file).toLowerCase() === ".pdf")
                .map(file => join(folderPath, file))
                .forEach(file => result.push(file))

            console.warn('list files found...', result)

            resolve(result)
        })
    })
}


async function loadDocuments(docs: string[]): Promise<Document[]> {
    const loader = new MultiFileLoader(docs, {
        '.pdf': (path) => new PDFLoader(path, {
            parsedItemSeparator: ' ',
            metadata: {
                filename: basename(path, extname(path)),
            },
        }),
        '.md': (path) => new TextLoader(path)
    });

    console.warn('loaded documents...', loader)

    return await loader.load();
}

async function summarize(docs: Document[]): Promise<Document[]> {
    const model = getModel('google')

    const queryOutput = z.object({
        title: z.string().describe("Title of the document"),
        summary: z.string().describe("Summary of the document"),
        content: z.string().describe("Full content of the document"),
        loc: z.object({
            pageNumber: z.number().describe("Page number"),
            section: z.string().describe("section name from the document"),
            source: z.string().describe("file name of the document"),
            lines: z.object({
                from: z.number().describe("Start line number"),
                to: z.number().describe("End line number"),
            })
                .describe("Line number")
        }).describe("Location of the summary"),
    });

    const prompt = PromptTemplate.fromTemplate(`
            You're a helpful AI assistant. 

            Given a CONTENT of a markdown content. 

            - remove all header and footer text usually duplicate with page number
            - remove unnecesary whitelines
            - if some context contains a separated table join it into one table
            - DO NOT REMOVE ANYTHING FROM THE CONTENT, ONLY REMOVE UNNECESARY WHITELINES, HEADER AND FOOTER TEXT
            - Summarize in indonesian language the following document with no more than 5 sentence, and give context with no more than 5 words what is it about based on the content,
            - and provide additional information from metadata like the title of the document, filename, page range number and line location of the information

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

    const idKey = "doc_id";
    const docIds = docs.map((_) => uuid());

    const summarized = summaries.map((summaryMap, i) => {
        const { summary, content, loc, title } = summaryMap

        return new Document({
            pageContent: content,
            metadata: {
                summary: summary,
                loc: loc,
                title: title,
                [idKey]: docIds[i],
            },
        });
    });

    const keyValuePairs: [string, Document][] = docs.map((originalDoc, i) => [
        docIds[i],
        originalDoc,
    ]);

    // const filename = summarized[0].metadata.loc.source.split('/')

    // writeToFile(`${filename[filename.length - 1]}_summary.json`, JSON.stringify(summarized))

    return summarized
}

const writeToFile = (filename: string, content: string) => {
    writeFile(`./public/documents/${filename}`, content, err => {
        if (err) {
            console.log(err)
        }
    })
}

async function run() {
    try {
        // await createTable()

        // const folderpath = resolve(join('./public', 'documents'));

        // const docs = await listDocuments(folderpath)

        // const loaders = await loadDocuments(docs)

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