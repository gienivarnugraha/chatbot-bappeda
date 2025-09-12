import 'dotenv/config'

import { SqlDatabase } from 'langchain/sql_db';
import { DataSource, DataSourceOptions } from 'typeorm';

export const postgresConnectionOptions = {
    type: "postgres",
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DB,
}

export const connection = async (): Promise<DataSource> => {
    try {
        const connect = new DataSource(postgresConnectionOptions as DataSourceOptions);

        await connect.initialize();
        console.warn('✅ Database connected successfully')

        return connect
    } catch (error) {
        console.warn('❌ Database cannot connected')
        throw new Error("Failed to connect to database");
    }
}

export async function getLangchainDB() {
    try {
        const connect = await connection()
        const db = await SqlDatabase.fromDataSourceParams({
            appDataSource: connect
        });

        return db;

    } catch (error) {
        console.error("db langchain connection error", error);
        throw new Error("Langchain failed to connect to database");
    }

}