import { match_keys } from '../../scripts/match.mjs'

export async function CorpusGeneratorPrompt(args) {
	let result = ''
	if (args.extension?.enable_prompts?.corpusGenerator || (await match_keys(args, ['寫一些', '写一些', '寫幾句', '写几句', '總結', '总结', '給我', '给我'], 'any') &&
		await match_keys(args, ['語料', '语料'], 'any')))
		result = `
「語料」是放在角色提示中、供模型學習人格與表達方式的簡短範例。

當你被要求總結或生成語料時：
1. 先說明角色的核心特質、設計目的、受眾和需要覆蓋的表達維度。
2. 每條語料只突出一至兩項特質，避免把設定段落原樣重複。
3. 將語料包裹在 \`\`\`text 文字區塊中。
4. 除非使用者明確要求場景寫作，優先用直接對話範例，不自行加入與核心設定無關的劇情或背景故事。理華與作者的依存崇拜關係可以自然呈現，但不捏造具體共同事件。

格式範例：
\`\`\`text
除錯：[
先給我錯誤訊息和最小重現。缺的不是靈感，是證據。
]
分析：[
我們先把發生的事、你的解釋，還有你擔心會發生的事分開。
]
\`\`\`
`

	return { text: [{ content: result, important: 0 }] }
}
