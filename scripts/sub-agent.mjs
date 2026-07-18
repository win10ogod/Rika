/**
 * 讀取工具標籤中的字串屬性。
 * @param {string} attrs 原始屬性文字。
 * @param {string} name 屬性名稱。
 * @returns {string | undefined} 屬性值；沒有該屬性時為 undefined。
 */
function getAttribute(attrs, name) {
	const match = String(attrs || '').match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
	return match ? (match[1] ?? match[2] ?? '') : undefined
}

/**
 * 從子代理工具呼叫中擷取第一個指定區塊。
 * @param {string} body 工具標籤內容。
 * @param {string} tag 區塊名稱。
 * @returns {string | undefined} 區塊內容。
 */
function getBlock(body, tag) {
	return String(body || '').match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.trim?.()
}

/**
 * 解析一則回覆中的所有子代理分派；多個標籤保持原始順序。
 * 同時接受 <delegate-agent> 與 <sub-agent>，輸出時建議使用前者。
 * @param {string} content AI 回覆內容。
 * @returns {Array<{
 *   index: number,
 *   name: string,
 *   task: string,
 *   context: string,
 *   modelSpecified: boolean,
 *   requestedModel: string,
 *   raw: string
 * }>} 解析後的子代理工作。
 */
export function parseSubAgentCalls(content) {
	const calls = []
	const regex = /<(?<tag>delegate-agent|sub-agent)\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/(?<closingTag>delegate-agent|sub-agent)>/gi
	for (const match of String(content || '').matchAll(regex)) {
		if (match.groups.tag.toLowerCase() !== match.groups.closingTag.toLowerCase()) continue
		const { attrs, body } = match.groups
		const context = getBlock(body, 'context') || ''
		const explicitTask = getBlock(body, 'task')
		const task = explicitTask ?? body.replace(/<context>[\s\S]*?<\/context>/gi, '').trim()
		const requestedModelAttribute = getAttribute(attrs, 'model')
		calls.push({
			index: calls.length,
			name: getAttribute(attrs, 'name')?.trim?.() || `agent-${calls.length + 1}`,
			task,
			context,
			modelSpecified: requestedModelAttribute !== undefined,
			requestedModel: requestedModelAttribute?.trim?.() || '',
			raw: match[0]
		})
	}
	return calls
}
