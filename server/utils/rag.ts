import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnablePassthrough, RunnableSequence, RunnableWithMessageHistory } from "@langchain/core/runnables";

import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "embedding-001",
});

const model = getModel()

const documents = "./public/document.pdf"


let messageHistories: { [sessionId: string]: ChatMessageHistory } = {};

const getMessageHistoryForSession = (sessionId: string) => {
    if (messageHistories[sessionId] !== undefined) {
        return messageHistories[sessionId];
    }
    const newChatSessionHistory = new ChatMessageHistory();

    messageHistories[sessionId] = newChatSessionHistory;

    return newChatSessionHistory;
};

const vectorStore = async (docs: Document[]) => {

    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1536, chunkOverlap: 128
    });
    const allSplits = await splitter.splitDocuments(docs);

    const store = new MemoryVectorStore(embeddings);

    // Index chunks
    await store.addDocuments(allSplits)

    return store
}

const createDocumentRetrievalChain = async () => {
    // const __dirname = fileURLToPath(new URL('.', import.meta.url));
    // const publicDir = resolve(__dirname, '../../public/documents/'); // Adjust path based on your file structure
    // const imagePath = join(publicDir, 'document.pdf');
    const dir = join(process.cwd(), 'chunks');
    console.warn(await readdir(dir))

    const dir2 = join(process.cwd());
    console.warn(await readdir(dir2))

    const imagePath = join(process.cwd(), 'documents', 'sampah.pdf');
    console.warn(resolve(imagePath))
    console.warn(await readFile(imagePath))

    //const imagePath2 = join(process.cwd(), 'documents', 'document.pdf');
    //console.warn(resolve(imagePath2))
    //console.warn(await readFile(imagePath2))

    const loader = new PDFLoader(imagePath);

    const docs = await loader.load();

    const store = await vectorStore(docs)

    const retriever = store.asRetriever()

    const convertDocsToString = (documents: Document[]) => {
        return documents.map((document) => `<doc>\n${document.pageContent}\n</doc>`).join("\n");
    };

    // Each of the runnables mentioned will be executed in sequence
    const documentRetrievalChain = RunnableSequence.from([
        (input) => input.standalone_question,
        retriever,
        convertDocsToString,
    ]);


    return documentRetrievalChain;
}

// make a prompt template for the response
const ANSWER_CHAIN_SYSTEM_TEMPLATE = `You are an experienced researcher,
expert at interpreting and answering questions based on provided sources.
Using the below provided context and chat history, answer the user's question to the best of your ability using only the resources provided. 
- Be verbose!
- Don't rewrite the question.-
- Answer in markdown format!
- Answer in indonesian langugage!
- End the answer with '--END--' mark!

<context>
{context}
</context>`;

// Define prompt for question-answering
const answerGenerationChainPrompt = ChatPromptTemplate.fromMessages([
    ["system", ANSWER_CHAIN_SYSTEM_TEMPLATE],
    new MessagesPlaceholder("history"),
    [
        "human",
        `Now, answer this question using the previous context and chat history:

    {standalone_question}`
    ]
]);

function createRephraseQuestionChain() {
    const REPHRASE_QUESTION_SYSTEM_TEMPLATE = `
    Given the following conversation and a follow up question,
    rephrase the follow up question to be a standalone question.
    `;

    // Rephrase the question to be a standalone question
    // along with passing the chat history
    const rephraseQuestionChainPrompt = ChatPromptTemplate.fromMessages([
        ["system", REPHRASE_QUESTION_SYSTEM_TEMPLATE],
        new MessagesPlaceholder("history"),
        ["human", "Rephrase the following question as a standalone question:\n{question}"],
    ]);

    // Runnable to rephrase the question
    const rephraseQuestionChain = RunnableSequence.from([
        rephraseQuestionChainPrompt,
        model,
        new StringOutputParser(),
    ]);
    return rephraseQuestionChain;
}
// retrieve the document from the vectorstore

export async function generateAnswerFromDocument() {

    const documentRetrievalChain = await createDocumentRetrievalChain()

    const conversationalRetrievalChain = RunnableSequence.from([
        RunnablePassthrough.assign({
            standalone_question: createRephraseQuestionChain,
        }),
        RunnablePassthrough.assign({
            context: documentRetrievalChain,
        }),
        answerGenerationChainPrompt,
        model,
    ]);

    const finalRetrievalChain = new RunnableWithMessageHistory({
        runnable: conversationalRetrievalChain,
        getMessageHistory: getMessageHistoryForSession,
        inputMessagesKey: "question",
        historyMessagesKey: "history",
    }).pipe(new StringOutputParser())

    return finalRetrievalChain;
}