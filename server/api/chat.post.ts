import { Readable } from "stream";
import { generateAnswerFromDocument } from "../utils/rag";
import util from 'node:util'

export default defineEventHandler(async (event) => {
    const { question, uuid } = await readBody(event)

    setHeaders(event, {
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "content-type": "text/event-stream"
    });

    try {
        //@ts-ignore
        //const response = await getQueryResult(question, config)
        const response = await generateAnswerFromDocument()

        const readable = new ReadableStream({
            async pull(controller) {
                for await (const message of await response.stream({ question }, {
                    configurable: { sessionId: uuid },
                })) {
                    console.log(
                        util.inspect(message, {
                            showHidden: false,
                            depth: null,
                            colors: true
                        })
                    )

                    console.log("\n====\n");
                    // @ts-ignore
                    if (message.includes('--END')) {
                        // @ts-ignore
                        let end = message.replace('--END--', '')

                        controller.enqueue(end);

                        controller.close();
                        break
                    }

                    controller.enqueue(message);
                }

            }
        });

        return readable

    } catch (err) {
        setResponseStatus(event, 400, "Streaming Error")
        console.error("Streaming error:", err, typeof err);
        return {
            error: 'Streaming error:',
            cause: err
        }
    }
})

/* 

*/