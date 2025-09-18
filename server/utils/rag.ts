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

let messageHistories: { [sessionId: string]: ChatMessageHistory } = {};

const getMessageHistoryForSession = (sessionId: string) => {
    if (messageHistories[sessionId] !== undefined) {
        return messageHistories[sessionId];
    }
    const newChatSessionHistory = new ChatMessageHistory();

    messageHistories[sessionId] = newChatSessionHistory;

    return newChatSessionHistory;
};


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

    return MultiQueryRetriever.fromLLM({
        llm: model,
        retriever: vectorstore.asRetriever(),
    });
}

const getContextChain = async () => {
    const retriever = getRetriever()

    return RunnableSequence.from([
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
    - if the context contains a table, add the answer format as table in Markdown use title case for heading
    - if the context contains a formula, add the answer format as formula in Markdown latex
    - if the context contains a chart, add the answer format as chart in Markdown latex
    - if the context contains a list, add the answer format as Markdown lists
    - if the context contains a image, prefix the image attachment with: ${process.env.DOCUMENT_PATH}
    - Answer in indonesian language
    - End the answer with __END__

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