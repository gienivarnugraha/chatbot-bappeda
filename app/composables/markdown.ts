import { marked } from 'marked';

import DOMPurify from 'dompurify'
export async function markdownToHtml(markdown: string): Promise<string> {

    marked.use({
        // renderer,
        gfm: true,
        breaks: true,
    })

    return DOMPurify.sanitize(await marked.parse(markdown));
}