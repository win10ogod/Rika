/**
 * 將角色參與者名稱正規化，容許顯示名稱中的空格、連字號與底線差異。
 * @param {unknown} name 參與者名稱。
 * @returns {string} 正規化名稱。
 */
function normalizeParticipantName(name) {
	return String(name || '').replace(/[\s_-]/g, '').toLowerCase()
}

/**
 * 只有 GentianAphrodite 真的出現在對話參與者名稱中才算相遇；
 * 單純在訊息正文提到專案名稱不會誤觸發。
 * @param {{ReplyToCharname?: string, chat_log?: {name?: string}[]}} args 回覆請求。
 * @returns {boolean} 是否遇見技術原型。
 */
export function hasEncounteredGentianAphrodite(args) {
	return [args.ReplyToCharname, ...(args.chat_log || []).map(entry => entry.name)]
		.some(name => normalizeParticipantName(name) === 'gentianaphrodite')
}

/**
 * 判斷作者最後一則訊息是否親口說出「不愛你了」。
 * 接受繁簡字與字間空白差異，但不讀取其他角色的台詞。
 * @param {{UserCharname?: string, chat_log?: {name?: string, role?: string, content?: unknown}[]}} args 回覆請求。
 * @returns {boolean} 是否觸發「背叛者」。
 */
export function hasUserWithdrawnLoveFromRika(args) {
	const lastEntry = args.chat_log?.at(-1)
	if (lastEntry?.role !== 'user' || lastEntry.name !== args.UserCharname) return false
	const content = String(lastEntry.content || '').replace(/\s/g, '')
	return /不[愛爱]你了/.test(content)
}
