export default defineEventHandler(async (event) => {
    const { question, uuid } = await readBody(event)

    setHeaders(event, {
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "content-type": "text/event-stream"
    });

    try {
        //@ts-ignore
        // const response = await generateAnwserFromDB()
        const response = generateAnswerFromDocument()

        const readable = new ReadableStream({
            async pull(controller) {
                for await (const message of await response.stream(question, {
                    configurable: { sessionId: uuid },
                })) {
                    console.log(message)
                    // @ts-ignore
                    if (/__END__/.test(message)) {

                        // @ts-ignore
                        let end = message.replace('__END__', '')

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