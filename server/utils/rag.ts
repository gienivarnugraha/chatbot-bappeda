import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnablePassthrough, RunnableSequence, RunnableWithMessageHistory } from "@langchain/core/runnables";
import { formatDocumentsAsString } from "langchain/util/document";
import { z } from 'zod'
import { getVectorStore, getModel } from "./ai";

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


/**
 * Given a user question, retrieve relevant context from the vectorstore to answer the question
 * @param input query string to retrieve relevant context
 * @returns a chain of runnables that will return the relevant context as a string
 */

const getContextChain = async () => {
    const retriever = getVectorStore()

    return RunnableSequence.from([
        {
            question: (input) => input.question,
        },
        analyzeQuestionChain,
        (input) => input.query,
        retriever.asRetriever(),
        //formatDocumentsAsString
    ])
}

const ANSWER_TEMPLATE = `You're a helpful AI assistant. 

    Given a user question, question and context. 
    If none of the articles answer the question, just say you don't know.
    Your task is to provide a accurate and detailed answer to the user's question based ONLY on the provided context include relevant table or image if needed

    - Return the answer with markdown format
    - Return the source of information at the end of the answer like document file name or location
    - if the answer contains a table, format the answer as table in Markdown use title case for heading
    - if the answer contains a list, format the answer as Markdown lists
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
    ["human", "{question}"],
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