import { pull } from "langchain/hub";
import { QuerySqlTool } from "langchain/tools/sql";
import { z } from "zod";
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { MultiFileLoader } from "langchain/document_loaders/fs/multi_file";
import { JSONLoader, JSONLinesLoader } from "langchain/document_loaders/fs/json";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";


import {
    ChatPromptTemplate,
    MessagesPlaceholder,
} from "@langchain/core/prompts";

export function getModel() {
    return new ChatGoogleGenerativeAI({
        temperature: 0,
        model: "gemini-2.0-flash",
        streaming: true
    });
}
export async function getQueryResult(question: string, config?: any) {
    const model = getModel()

    const queryOutput = z.object({
        query: z.string().describe("Syntactically valid SQL query."),
    });

    const structuredLlm = model.withStructuredOutput(queryOutput);

    try {
        const db = await getLangchainDB();

        const queryPromptTemplate = await pull<ChatPromptTemplate>(
            "langchain-ai/sql-query-system-prompt"
        );

        /* Write Query */
        const promptQuery = await queryPromptTemplate.invoke({
            dialect: db.appDataSourceOptions.type,
            top_k: 10,
            table_info: await db.getTableInfo(),
            input: question,
        });
        const queryResult = await structuredLlm.invoke(promptQuery);

        /* Execute Query */
        const executeQuery = new QuerySqlTool(db);
        const sqlResult = await executeQuery.invoke(queryResult.query)

        /* Generate Answer */
        const promptAnswer =
            "Given the following user question, corresponding SQL query," +
            "and SQL result, answer the user question.\n\n" +
            "Please provide a clear, conversational summary that:\n" +
            "- Directly answers the user's question, do not repeat the statement.\n" +
            "- Answer in Indonesian Language.\n" +
            "- Return the answer in Markdown Format.\n" +
            "- If the answer is a table, format the answer as table in Markdown use pascal case for heading.\n" +
            "- give `--END--` statement in the end of the answer. \n" +
            `Question: {question}\n` +
            `SQL Query: {queryResult}\n` +
            `SQL Result: {sqlResult}\n`;
        "\n";

        const prompt = ChatPromptTemplate.fromTemplate(promptAnswer);

        const parser = new StringOutputParser();

        const chain = prompt.pipe(model).pipe(parser);

        /* Generate Response */
        return await chain.stream({
            question,
            queryResult,
            sqlResult
        }, config);

    } catch (error) {
        console.error('Get Query Error:', error);
        throw new Error('Failed to get query result');
    }

}

export async function documentLoaders() {

    const loader = new MultiFileLoader(
        [
            "src/document_loaders/example_data/example/example.txt",
            "src/document_loaders/example_data/example/example.csv",
            "src/document_loaders/example_data/example2/example.json",
            "src/document_loaders/example_data/example2/example.jsonl",
        ],
        {
            ".json": (path) => new JSONLoader(path, "/texts"),
            ".jsonl": (path) => new JSONLinesLoader(path, "/html"),
            ".txt": (path) => new TextLoader(path),
            ".csv": (path) => new CSVLoader(path, "text"),
        }
    );
    const docs = await loader.load();
    console.log({ docs });
    return docs
}
