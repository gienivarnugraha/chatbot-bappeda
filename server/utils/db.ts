import 'dotenv/config'

import { SqlDatabase } from 'langchain/sql_db';
import { DataSource } from 'typeorm';

export async function getLangchainDB() {
    try {
        const connection = new DataSource({
            type: 'mysql',
            host: process.env.MYSQL_HOST,
            port: 3306,
            username: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
        });


        await connection.initialize();
        console.warn('✅ Database connected successfully')

        const db = await SqlDatabase.fromDataSourceParams({
            appDataSource: connection
        });

        return db;

    } catch (error) {
        console.error("db connection error", error);
        throw new Error("Failed to connect to database");
    }

}