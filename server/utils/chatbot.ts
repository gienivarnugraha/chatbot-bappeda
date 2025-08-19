import 'dotenv/config'

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { pull } from "langchain/hub";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { QuerySqlTool } from "langchain/tools/sql";
import { StateGraph } from "@langchain/langgraph";
import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

import { getLangchainDB } from './db';
// import { prepareChartData } from './chart';

const llm = new ChatGoogleGenerativeAI({
    temperature: 0,
    model: "gemini-2.0-flash",
    streaming: true
});


/* 
const InputStateAnnotation = Annotation.Root({
    question: Annotation<string>,
});

const StateAnnotation = Annotation.Root({
    question: Annotation<string>,
    query: Annotation<string>,
    result: Annotation<string>,
    answer: Annotation<string>,
});

const queryOutput = z.object({
    query: z.string().describe("Syntactically valid SQL query."),
});

const structuredLlm = llm.withStructuredOutput(queryOutput);


export async function queryToMarkdown() {
    const db = await getLangchainDB();

    const queryPromptTemplate = await pull<ChatPromptTemplate>(
        "langchain-ai/sql-query-system-prompt"
    );

    const writeQuery = async (state: typeof InputStateAnnotation.State) => {
        const promptValue = await queryPromptTemplate.invoke({
            dialect: db.appDataSourceOptions.type,
            top_k: 10,
            table_info: await db.getTableInfo(),
            input: state.question,
        });

        const result = await structuredLlm.invoke(promptValue);

        return { query: result.query };
    };

    const executeQuery = async (state: typeof StateAnnotation.State) => {
        const executeQueryTool = new QuerySqlTool(db);

        return { result: await executeQueryTool.invoke(state.query) };
    };

    const generateAnswer = async (state: typeof StateAnnotation.State) => {
        const promptValue =
            "Given the following user question, corresponding SQL query," +
            "and SQL result, answer the user question.\n\n" +
            "Please provide a clear, conversational summary that:\n" +
            "- Directly answers the user's question.\n" +
            "- Is formatted in markdown.\n" +
            "- Answer in Indonesian Language.\n\n" +
            "\n" +
            `Question: ${state.question}\n` +
            `SQL Query: ${state.query}\n` +
            `SQL Result: ${state.result}\n`;
        const response = await llm.invoke(promptValue);
        return { answer: response.content };
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

    return graphBuilder;

} */