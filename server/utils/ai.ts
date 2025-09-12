import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import supabase from "./supabase";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
export function getModel(model: 'google' | 'openai' | 'ollama' = 'google') {
    switch (model) {
        default:
            return new ChatGoogleGenerativeAI({
                temperature: 0,
                model: "gemini-2.0-flash",
                streaming: true
            });
        case 'openai':
            return new ChatOpenAI({
                temperature: 0,
                model: "gpt-4o-mini",
                streaming: true
            });
        case 'ollama':
            return new ChatOllama({
                model: "deepseek-r1:1.5b", // Default value
                temperature: 0,
                maxRetries: 2,
                // other params...
            });
    }

}

export function getEmbedding(model?: 'google' | 'openai') {
    switch (model) {
        case 'google':
            return new GoogleGenerativeAIEmbeddings({
                model: "embedding-001",
            });

        default:
            return new OpenAIEmbeddings({
                model: "text-embedding-ada-002",
            });
    }
}

export function getVectorStore(): SupabaseVectorStore {
    const embedding = getEmbedding()

    return new SupabaseVectorStore(embedding, {
        client: supabase,
        tableName: 'documents_summary',
        queryName: 'match_documents'
    })
}

