-- First, ensure the 'pgvector' extension is installed and enabled.
-- If not, you may need to install it on your system and then run this command:
CREATE EXTENSION IF NOT EXISTS vector;

-- This command creates a new table named 'vector_store' to hold your vector embeddings.
CREATE TABLE IF NOT EXISTS vector_stores (
    id BIGSERIAL PRIMARY KEY,
    -- The VECTOR data type is provided by the pgvector extension.
    -- The number in parentheses is the dimension of your embeddings (e.g., 1536 for OpenAI's ada-002 model).
    embedding VECTOR(1536), 
    
    -- An optional column to store the original text or metadata associated with the embedding.
    content TEXT,
	metadata TEXT
);

-- Creating an index on the embedding column is crucial for fast similarity searches.
-- This GIST index is highly recommended for large datasets and efficient lookups.
CREATE INDEX ON vector_stores USING GIST (embedding);
