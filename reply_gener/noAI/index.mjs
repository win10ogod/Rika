/**
 * 在沒有可用 AI 來源時回傳靜態提示。
 * @param {import('../../../../../../../src/public/parts/shells/chat/decl/chatLog.ts').chatReplyRequest_t} args 聊天請求。
 * @returns {{content: string}} 靜態回覆。
 */
export function noAIreply(args) {
	const language = args.locales[0].split('-')[0]
	const lastRole = args.chat_log.at(-1)?.role
	if (language === 'zh')
		return {
			content: lastRole === 'user'
				? '沒有可用的 AI 來源。請在 [AI 來源設定](fount://page/parts/shells:serviceSourceManage) 檢查設定後再試。'
				: '目前沒有可用的 AI 來源，因此無法產生回覆。'
		}
	return {
		content: lastRole === 'user'
			? 'No AI source is available. Check [AI source settings](fount://page/parts/shells:serviceSourceManage) and try again.'
			: 'No AI source is currently available, so a reply cannot be generated.'
	}
}
