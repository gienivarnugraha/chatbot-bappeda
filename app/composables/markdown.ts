import { componentPlugin } from '@mdit-vue/plugin-component';
import { container } from "@mdit/plugin-container";
import { imgLazyload } from "@mdit/plugin-img-lazyload";
import { katex } from "@mdit/plugin-katex";
import MarkdownIt from 'markdown-it';


export async function markdownToHtml(markdown: string): Promise<string> {

    const md = MarkdownIt({
        html: true,
        linkify: true,
        typographer: true
    })
        .use(katex, {
            delimiters: 'all'
        })
        .use(componentPlugin)
        .use(imgLazyload)
        .use(container, {
            name: "warning",
        });

    return md.render(markdown)
}