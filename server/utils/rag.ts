import { ChatPromptTemplate, MessagesPlaceholder, PromptTemplate } from "@langchain/core/prompts";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnablePassthrough, RunnableSequence, RunnableWithMessageHistory } from "@langchain/core/runnables";
import { formatDocumentsAsString } from "langchain/util/document";
import { z } from 'zod'
import { getVectorStore, getModel } from './ai';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { MarkdownTextSplitter, RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { ParentDocumentRetriever } from 'langchain/retrievers/parent_document';
import { InMemoryStore } from "@langchain/core/stores";
import supabase from './supabase'
import { MultiFileLoader } from 'langchain/document_loaders/fs/multi_file';
import { Document } from "@langchain/core/documents";
import { readdir } from 'node:fs';
import { basename, extname, join } from "node:path";
import { MultiVectorRetriever } from 'langchain/retrievers/multi_vector';
import { v4 as uuid } from 'uuid'
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import * as cheerio from 'cheerio';
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";
import { MultiQueryRetriever } from "langchain/retrievers/multi_query";

// const model = getModel('google')
const idKey = 'doc_id'

let messageHistories: { [sessionId: string]: ChatMessageHistory } = {};

const getMessageHistoryForSession = (sessionId: string) => {
    if (messageHistories[sessionId] !== undefined) {
        return messageHistories[sessionId];
    }
    const newChatSessionHistory = new ChatMessageHistory();

    messageHistories[sessionId] = newChatSessionHistory;

    return newChatSessionHistory;
};

const analyzeQuestionChain = () => {

    const model = getModel('google')

    const filterStructure = z.object({
        query: z.string().describe("Query context based on the question"),
    })

    const analyzeQuestion = `
    You're a helpful AI assistant.

    Given a user question. 
    {question}

    Your task is to reprhase the question in postgres vector filtering language
    then translate to indonesia
    `

    const analyzePrompt = ChatPromptTemplate.fromMessages([
        ["system", analyzeQuestion],
        ["human", "{question}"],
    ]);

    return RunnableSequence.from([
        {
            question: new RunnablePassthrough(),
        },
        analyzePrompt,
        model.withStructuredOutput(filterStructure),
    ])
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
 * @returns An object with two properties: parentSplitter and childSplitter
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

    // const childSplitter = new RecursiveCharacterTextSplitter({
    //     chunkSize: 768,
    //     chunkOverlap: 0,
    // })

    // return { parentSplitter, childSplitter }
}


/**
 * Returns a MultiVectorRetriever instance that is used to search for similar
 * documents in the vector store. It takes the vector store and byte store as
 * parameters, and also the id key of the documents, and the number of nearest
 * neighbors to retrieve for child and parent documents.
 * @returns {MultiVectorRetriever} - An instance of MultiVectorRetriever that can be used to search for similar documents.
 */
//export const getRetriever = (): MultiVectorRetriever => {
export const getRetriever = (): MultiQueryRetriever => {
    const vectorstore = getVectorStore()
    const model = getModel('google')

    // const byteStore = new InMemoryStore<Uint8Array>();

    // return new MultiVectorRetriever({
    //     vectorstore,
    //     byteStore,
    //     idKey,
    //     childK: 20,
    //     parentK: 5,
    // });
    return MultiQueryRetriever.fromLLM({
        llm: model,
        retriever: vectorstore.asRetriever(),
    });
}

export const storeToDB = async ({ docs, filename, docIds }: { docs: Document[], filename: string, docIds: string[] }) => {
    const { summary, title } = await getDocumentSummary(docs.slice(0, 5))

    const fileId = `${filename}_${uuid()}`

    const { error } = await supabase
        .from('documents')
        .insert({
            uuid: fileId,
            title,
            filename,
            metadata: {
                ids: docIds,
                summary
            }
        })

    console.log('success creating new data...')

    if (error) {
        console.log('error', error)
    }

    return fileId
}

/**
 * A function that takes an array of documents as parameters and returns a promise that resolves to an object 
 * with the following properties: title, summary, context, and source. 
 * It uses the Google AI model to summarize the document.
 * @param documents - A slice of array from Document instances.
 * @returns A promise that resolves to an object with the following properties: title, summary, context, and source.
 */
export const getDocumentSummary = async (documents: Document[]) => {
    console.log('getting documents summary...')

    const model = getModel('google')

    const queryOutput = z.object({
        title: z.string().describe("Title of the document"),
        summary: z.string().describe("Summary of the document"),
        context: z.string().describe("Contextof the document"),
        source: z.string().describe("file name of the document"),
    });

    const prompt = PromptTemplate.fromTemplate(`
            You're a helpful AI assistant. 

            - Summarize in indonesian language the following document with no more than 5 sentence
            - Give context with no more than 5 words what is it about based on the content,
            - and provide additional information from metadata like the title of the document, filename information

            Content:
            {content}
            `)

    const content = formatDocumentsAsString(documents)

    const chain = RunnableSequence.from([
        prompt,
        model.withStructuredOutput(queryOutput),
    ]);

    return await chain.invoke({ content });

}

export const getDocStore = async (file: string) => {

    // const retriever = getRetriever()
    const vectorstore = getVectorStore()

    const documents = await loadDocument(file)

    //const { parentSplitter, childSplitter } = documentSplitter(file)
    const parentSplitter = documentSplitter(file)

    const parentDocs = await parentSplitter.splitDocuments(documents)

    const filename = basename(file, extname(file))

    // const { data: doc_id, error } = await supabase
    //     .from('documents_summary')
    //     .select('metadata->doc_id')


    console.log('getting ids from database...')

    const { data, error } = await supabase
        .from('documents')
        .select()
        .ilike('filename', `%${filename}%`)

    if (error) {
        console.error('Failed to get documents from database', error)
    }

    let docIds: string[] = []

    if (data?.length) {
        console.log('file exists in database...')

        const ids = data?.map((_) => _.metadata.ids).flat() as string[]

        docIds = [...new Set(ids)]
    } else {
        console.log('file not exists in database, creating new data...')

        //docIds = parentDocs.map((_) => uuid());
        docIds = parentDocs.map((_, i) => `${filename}_${i}`);

        const fileId = await storeToDB({ docs: parentDocs, filename, docIds })

        // const subDocs: Document[] = [];
        // for (let i = 0; i < parentDocs.length; i += 1) {
        //     const childDocs = await childSplitter.splitDocuments([parentDocs[i]]);

        //     const taggedChildDocs = childDocs.map((childDoc) => {
        //         // eslint-disable-next-line no-param-reassign
        //         childDoc.metadata[idKey] = docIds[i];
        //         childDoc.metadata['source_id'] = fileId;
        //         return childDoc;
        //     });

        //     subDocs.push(...taggedChildDocs);
        // }

        console.log('adding data to vector store...')
        // await retriever.vectorstore.addDocuments(subDocs);

        const docs = parentDocs.map((doc, i) => {
            // eslint-disable-next-line no-param-reassign
            doc.metadata[idKey] = docIds[i];
            doc.metadata['source_id'] = fileId;
            return doc;
        });

        await vectorstore.addDocuments(docs);
    }

    // const keyValuePairs: [string, Document][] = parentDocs.map((originalDoc, i) => [
    //     docIds[i],
    //     originalDoc,
    // ]);

    // await retriever.docstore.mset(keyValuePairs);

    // return retriever
    return vectorstore
}

/**
 * Given a user question, retrieve relevant context from the vectorstore to answer the question
 * @param input query string to retrieve relevant context
 * @returns a chain of runnables that will return the relevant context as a string
 */

const getContextChain = async (file: string) => {
    const path = `${process.env.DOCUMENT_PATH}/${file}`

    const retriever = getRetriever()

    return RunnableSequence.from([
        // {
        //     question: (input) => input.question,
        // },
        // analyzeQuestionChain,
        (input) => input.question,
        retriever,
        formatDocumentsAsString
    ])
}

const ANSWER_TEMPLATE = `You're a helpful deep research AI assistant. 

    Given a user question, and context. 
    Your task is to provide detailed answer to the user's question based ONLY on the provided context include relevant table or image if needed

    - Return the answer with markdown format
    - Return the source of information at the end of the answer like document file name or location
    - if the context contains a table, format the answer as table in Markdown use title case for heading
    - if the context contains a list, format the answer as Markdown lists
    - if the context contains a image, prefix the image attachment with: ${process.env.DOCUMENT_PATH}
    - Answer in indonesian language
    - End the answer with --END--

    Context
    {context}

    Question: {question}

    Answer:
    Source:
    `;

const answerPrompt = ChatPromptTemplate.fromMessages([
    ["system", ANSWER_TEMPLATE],
    // new MessagesPlaceholder("history"),
    new MessagesPlaceholder("question"),
    new MessagesPlaceholder("context"),
]);


export function generateAnswerFromDocument() {

    const model = getModel('google')

    const answerChain = RunnableSequence.from([
        {
            question: new RunnablePassthrough(),
        },
        RunnablePassthrough.assign({
            context: getContextChain,
        }),
        answerPrompt,
        model,
        new StringOutputParser
    ])

    return answerChain

    // const finalRetrievalChain = new RunnableWithMessageHistory({
    //     runnable: answerChain,
    //     getMessageHistory: getMessageHistoryForSession,
    //     inputMessagesKey: "question",
    //     historyMessagesKey: "history",
    // }).pipe(new StringOutputParser())

    // return finalRetrievalChain;
}