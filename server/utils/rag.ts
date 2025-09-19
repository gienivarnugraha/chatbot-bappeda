import { ChatPromptTemplate, MessagesPlaceholder, PromptTemplate } from "@langchain/core/prompts";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnablePassthrough, RunnableSequence, RunnableWithMessageHistory } from "@langchain/core/runnables";
import { formatDocumentsAsString } from "langchain/util/document";
import { getVectorStore, getModel } from './ai';
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
//    - if the context contains a chart, add the answer format as <Chart> component in new line
const ANSWER_TEMPLATE = `You're a helpful deep research AI assistant. 

    Given a user question, and context. 
    Your task is to provide detailed answer to the user's question based ONLY on the provided context include relevant table or image if needed
    if you are not sure with the answer, you can ask the user again to confirm the question

    - Return the answer with markdown format
    - Return the source of information at the end of the answer like document file name or location
    - if the context contains a table, add the answer format as table in Markdown use title case for heading in new line
    - if the context contains a formula, add the answer format as formula in Markdown katex in new line
    - if the context contains a list, add the answer format as Markdown lists in new line
    - if the context contains a image, replace the image base link with: ${process.env.DOCUMENT_PATH} and return as markdown image format in new line
    - Answer in indonesian language
    - End the answer with __END__

    Context
    {context}

    Question: 
    {question}

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