import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { pull } from "langchain/hub";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { QuerySqlTool } from "langchain/tools/sql";
import { StateGraph } from "@langchain/langgraph";
import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

import { getLangchainDB } from './db';
import { RunnableWithMessageHistory } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";

const chatsBySessionId: Record<string, InMemoryChatMessageHistory> = {};

const llm = new ChatGoogleGenerativeAI({
    temperature: 0,
    model: "gemini-2.0-flash",
    streaming: true
});

const getChatHistory = (sessionId: string) => {
    let chatHistory: InMemoryChatMessageHistory | undefined =
        chatsBySessionId[sessionId];
    if (!chatHistory) {
        chatHistory = new InMemoryChatMessageHistory();
        chatsBySessionId[sessionId] = chatHistory;
    }
    return chatHistory;
};


const InputStateAnnotation = Annotation.Root({
    question: Annotation<string>,
});

const StateAnnotation = Annotation.Root({
    question: Annotation<string>,
    history: Annotation<ChatMessageHistory>,
    query: Annotation<string>,
    result: Annotation<string>,
    answer: Annotation<string>,
});

const queryOutput = z.object({
    query: z.string().describe("Syntactically valid SQL query."),
});

const structuredLlm = llm.withStructuredOutput(queryOutput);


export async function generateAnwserFromDB() {
    const db = await getLangchainDB();

    const queryPromptTemplate = await pull<ChatPromptTemplate>(
        "langchain-ai/sql-query-system-prompt"
    );

    const writeQuery = async (state: typeof InputStateAnnotation.State) => {
        try {
            const promptValue = await queryPromptTemplate.invoke({
                dialect: db.appDataSourceOptions.type,
                top_k: 10,
                table_info: await db.getTableInfo(),
                input: state.question,
            });

            const result = await structuredLlm.invoke(promptValue);

            console.log('write:', result)

            return { query: result.query };
        } catch (error) {
            throw new Error('Error writing query')
        }
    };

    const executeQuery = async (state: typeof StateAnnotation.State) => {
        try {
            const executeQueryTool = new QuerySqlTool(db);

            const result = await executeQueryTool.invoke(state.query)
            console.log('execute:', result)

            return { result };
        } catch (error) {
            throw new Error('Error executing the query')
        }
    };

    const generateAnswer = async (state: typeof StateAnnotation.State) => {
        try {
            const promptValue =
                `Given the following user question with chat history, corresponding SQL query,
                and SQL result, answer the user question.
                Please provide a clear, conversational summary that:
                - Directly answers the user's question.
                - Is formatted in markdown.
                - Answer in Indonesian Language.
                
                Question: ${state.question}
                History: ${state.history}
                SQL Query: ${state.query}
                SQL Result: ${state.result}`

            console.log(promptValue)

            const response = await llm.invoke(promptValue);
            return { answer: response.content };
        } catch (error) {
            throw new Error('Error generating the  answer')
        }
    };


    const graphBuilder = new StateGraph({
        stateSchema: StateAnnotation,
    })
        .addNode("writeQuery", writeQuery)
        .addNode("executeQuery", executeQuery)
        .addNode("generateAnswer", generateAnswer)
        .addEdge("__start__", "writeQuery")
        .addEdge("writeQuery", "executeQuery")
        .addEdge("executeQuery", "generateAnswer")
        .addEdge("generateAnswer", "__end__")
        .compile();


    const finalChain = new RunnableWithMessageHistory({
        runnable: graphBuilder,
        getMessageHistory: getChatHistory,
        inputMessagesKey: "question",
        historyMessagesKey: "history",
    }).pipe(new StringOutputParser())

    return finalChain;

} 