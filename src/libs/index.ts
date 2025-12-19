import '@logseq/libs';
import { OpenAI, toMessages } from '@libs/openai';
import { settingsSchema, getSettings } from './settings';

/**
 * Recursively aggregate all content on tree nodes.
 * @param uuid Block ID
 * @param isRecord Whether it is recorded
 */
async function summary(uuid: string, isRecord: boolean): Promise<string> {
    let { content, children }: any = await logseq.Editor.getBlock(uuid);
    if (undefined === children) {
        return content || '';
    }

    content = isRecord ? content : '';
    for (let child of children) {
        content += '\n\n';
        content += await summary(child[1], true);
    }
    return content;
}

// 过滤思考内容标签
const filterThinkingContent = (content: string): string => {
    // 处理完整的 <thinking></thinking> 标签
    let filtered = content.replace(/<thinking>.*?<\/thinking>/gs, '');
    // 处理完整的 <think></think> 标签
    filtered = filtered.replace(/<think>.*?<\/think>/gs, '');
    // // 处理单独的 </thinking> 或 </think> 结束标签
    // filtered = filtered.replace(/<\/thinking>/g, '').replace(/<\/think>/g, '');
    // // 处理单独的 <thinking> 或 <think> 开始标签
    // filtered = filtered.replace(/<thinking>/g, '').replace(/<think>/g, '');
    return filtered.trim();
};

async function openaiMessage(
    block_id: string,
    user_content: string,
    opts?: {
        system_content?: string,
        assistant_content?: string
    }
): Promise<void> {
    try {
        const { openaiKey, openaiAddress, gptModel, isHideThinking } = await getSettings();
        const openai: OpenAI = new OpenAI(openaiKey, openaiAddress, gptModel);
        const uuid: string|undefined = (await logseq.Editor.insertBlock(block_id, `loading...`))?.uuid;

        const result = await openai.chat(toMessages(
            user_content, {
            system: opts?.system_content,
            assistant: opts?.assistant_content
        }), false);

        // 如果隐藏思考过程，过滤掉思考内容标签
        const processedResult = isHideThinking ? filterThinkingContent(result) : result;

        if (uuid) {
            await logseq.Editor.updateBlock(uuid, processedResult);
        } else {
            await logseq.Editor.insertBlock(block_id, processedResult);
        }
        await logseq.Editor.editBlock(block_id);
    } catch (err: any) {
        logseq.UI.showMsg(err.message, 'error');
    }
}

/**
 * Use openai chat api to stream content output.
 * @param block_id block ID
 * @param user_content content
 * @param opts gpt prompt
 */
async function openaiStream(
    block_id: string,
    user_content: string,
    opts?: {
        system_content?: string,
        assistant_content?: string
    }
): Promise<void> {
    try {
        const { openaiKey, openaiAddress, gptModel, isHideThinking } = await getSettings();
        const openai: OpenAI = new OpenAI(openaiKey, openaiAddress, gptModel);
        const uuid: string|undefined = (await logseq.Editor.insertBlock(block_id, `loading...`))?.uuid;

        // If hide thinking is enabled, use non-streaming mode
        if (isHideThinking) {
            const result = await openai.chat(toMessages(
                user_content, {
                system: opts?.system_content,
                assistant: opts?.assistant_content
            }), false);

            // 过滤思考内容标签
            const processedResult = filterThinkingContent(result);

            if (uuid) {
                await logseq.Editor.updateBlock(uuid, processedResult);
            } else {
                await logseq.Editor.insertBlock(block_id, processedResult);
            }
        } else {
            // Original streaming mode
            let result: string = "", text: string = "";
            const decoder = new TextDecoder("utf-8");
            const reader = (await openai.chat(toMessages(
                user_content, {
                system: opts?.system_content,
                assistant: opts?.assistant_content
            }))).body?.getReader();

            while (undefined !== uuid) {
                const { done, value }: any = await reader?.read();
                if( done ) { break; }

                try {
                    const lines = decoder.decode(value).split("\n");
                    lines.map((line) => line.replace(/^data: /, "").trim())
                        .filter((line) => line !== "" && line !== "[DONE]")
                        .map((line) => JSON.parse(line))
                        .forEach((line) => {
                            text = line.choices[0].delta?.content as string;
                            result += text ? text : '';
                        })
                    await logseq.Editor.updateBlock(uuid, result);
                } catch(err: any) {
                    // Avoid situations where the presence of 
                    // certain escape characters causes output failure.
                    continue;
                }
            }
        }
        await logseq.Editor.editBlock(block_id);
    } catch (err: any) {
        logseq.UI.showMsg(err.message, 'error');
    }
}

async function generateAdvancedQuery(content: string, block_id: string) {
    try {
        const { openaiKey, openaiAddress, gptModel, promptAdvancedQuery, isHideThinking } = await getSettings();
        const openai: OpenAI = new OpenAI(openaiKey, openaiAddress, gptModel);
        const uuid: string|undefined = (await logseq.Editor.insertBlock(block_id, `loading...`))?.uuid;

        if (undefined != uuid) {
            const result: string = (await openai.chat(toMessages(
                content + '(output the code text only without additional explanations.)', {
                system: promptAdvancedQuery
            }), false));

            // 如果隐藏思考过程，过滤掉思考内容标签
            const processedResult = isHideThinking ? filterThinkingContent(result) : result;

            await logseq.Editor.updateBlock(uuid, processedResult.replace(/^```+|```+$/g, ''));
            await logseq.Editor.editBlock(block_id);
        }
    } catch (err: any) {
        logseq.UI.showMsg(err.message, 'error');
    }
}

export {
    settingsSchema,
    summary,
    openaiStream,
    openaiMessage,
    generateAdvancedQuery
}