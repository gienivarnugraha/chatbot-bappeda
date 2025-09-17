import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnablePassthrough, RunnableSequence, RunnableWithMessageHistory } from "@langchain/core/runnables";
import { formatDocumentsAsString } from "langchain/util/document";
import { z } from 'zod'
import { getVectorStore, getModel } from "./ai";
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

// const model = getModel('google')

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

const loadDocuments = async (dir: string[]): Promise<Document[]> => {
    const loader = new MultiFileLoader(dir, {
        // '.pdf': (path) => new PDFLoader(path, {
        //     parsedItemSeparator: ' ',
        //     metadata: {
        //         filename: basename(path, extname(path)),
        //     },
        // }),
        '.md': (path) => new TextLoader(path)
    });

    console.warn('loaded documents...', loader)

    return await loader.load();
}

export const getRetriever = (): MultiVectorRetriever => {
    const vectorstore = getVectorStore()

    const byteStore = new InMemoryStore<Uint8Array>();

    return new MultiVectorRetriever({
        vectorstore,
        byteStore,
        idKey: 'doc_id',
        // Optional `k` parameter to search for more child documents in VectorStore.
        // Note that this does not exactly correspond to the number of final (parent) documents
        // retrieved, as multiple child documents can point to the same parent.
        childK: 20,
        // Optional `k` parameter to limit number of final, parent documents returned from this
        // retriever and sent to LLM. This is an upper-bound, and the final count may be lower than this.
        parentK: 5,
    });
}

/**
 * Given a user question, retrieve relevant context from the vectorstore to answer the question
 * @param input query string to retrieve relevant context
 * @returns a chain of runnables that will return the relevant context as a string
 */

const getContextChain = async () => {
    const retriever = getRetriever()

    const doc = new CheerioWebBaseLoader("https://raw.githubusercontent.com/gienivarnugraha/chatbot-bappeda/refs/heads/main/public/documents/sampah.md");

    // const doc = new TextLoader(cheerioLoader)

    const documents = await doc.load()

    const path = basename(documents[0].metadata.source)

    const splitter = new RecursiveCharacterTextSplitter({
        chunkOverlap: 10,
        chunkSize: 768 * 8,
    })

    const childSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 768,
        chunkOverlap: 0,
    })

    const docs = await splitter.splitDocuments(documents)

    const { data: doc_id, error } = await supabase
        .from('documents_summary')
        .select('metadata->doc_id')

    //@ts-ignore
    const ids = doc_id.map((_) => _.doc_id) as string[]

    let docIds: string[] = []

    if (ids.length) {
        docIds = [...new Set(ids)]
    } else {
        docIds = docs.map((_) => uuid());


        const { error } = await supabase
            .from('documents')
            .insert({
                //uuid: uuid()
                title: 'Kajian Sampah Kota Semarang',
                filename: path,
                ids: docIds
            })

        if (error) {
            console.log('error', error)
        }

        const taggedOriginalDocs = docs.map((doc, i) => {
            doc.metadata['doc_id'] = docIds[i];
            return doc;
        });

        retriever.vectorstore.addDocuments(taggedOriginalDocs);
    }

    const subDocs: Document[] = [];

    for (let i = 0; i < docs.length; i += 1) {
        const childDocs = await childSplitter.splitDocuments([docs[i]]);
        const taggedChildDocs = childDocs.map((childDoc) => {
            // eslint-disable-next-line no-param-reassign
            childDoc.metadata['doc_id'] = docIds[i];
            return childDoc;
        });
        subDocs.push(...taggedChildDocs);
    }

    const keyValuePairs: [string, Document][] = docs.map((originalDoc, i) => [
        docIds[i],
        originalDoc,
    ]);

    console.log(docs.length, subDocs.length, keyValuePairs.length)

    // Use the retriever to add the original chunks to the document store
    await retriever.docstore.mset(keyValuePairs);

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
    - if the context contains a image, attach the image
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
    // ["human", "{question}"],
    // ["human", "{context}"],
]);


export function generateAnswerFromDocument() {

    const model = getModel('google')

    const answerChain = RunnableSequence.from([
        {
            question: new RunnablePassthrough(),
        },
        RunnablePassthrough.assign({
            context: getContextChain,
            question: (input) => input.question,
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