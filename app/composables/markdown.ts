// import { marked } from 'marked';
// import DOMPurify from 'dompurify'

import markdownit from 'markdown-it'

export async function markdownToHtml(markdown: string): Promise<string> {

    const md = markdownit({
        html: true,
        linkify: true,
        typographer: true
    })

    return md.render(markdown)
    // marked.use({
    //     // renderer,
    //     gfm: true,
    //     breaks: true,
    // })

    // return DOMPurify.sanitize(await marked.parse(markdown));
}