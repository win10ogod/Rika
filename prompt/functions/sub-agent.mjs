/**
 * 向主代理提供子代理分派工具。
 * @param {import('../../../../../../../src/public/parts/shells/chat/decl/chatLog.ts').chatReplyRequest_t} args 回覆請求。
 * @returns {{text: {content: string, important: number}[]}} 工具提示。
 */
export function SubAgentPrompt(args) {
	if (args.extension?.is_sub_agent) return { text: [] }
	return {
		text: [{
			content: `
你可以把可獨立處理的工作分派給內部子代理。子代理會繼承目前完整聊天記錄，使用隔離的工作對話，完成後只把結果交回給你；你必須再根據結果回覆作者。

未指定模型時，子代理復用產生你當輪回覆的同一個 AI 來源：
<delegate-agent name="任務名稱">
	<task>清楚、完整且有驗收條件的子任務</task>
	<context>只屬於此子任務的補充資料，可省略</context>
</delegate-agent>

若要使用配置中的「子代理專用模型」，加入 model 屬性：
<delegate-agent name="任務名稱" model="dedicated">
	<task>交給專用模型的子任務</task>
</delegate-agent>

規則：
- model 屬性省略：復用當輪主 AI 來源。model 屬性存在：嚴格使用 AIsources 中的 sub-agent 專用來源；未配置或失敗時不會偷偷 fallback。
- 一次回覆可以輸出多個 <delegate-agent>；它們會並行執行，適合互不依賴的研究、審查、實作或比較工作。
- 分派內容本身不要夾帶給作者的答案。等待工具結果回到聊天記錄後，再自行驗證、取捨並彙整。
- 子代理可以使用一般工具，但不能再次建立子代理，也不能直接通知作者。
- 簡單問題直接處理；只有任務能從獨立上下文或並行工作中實際受益時才分派。
`,
			important: 0
		}]
	}
}
