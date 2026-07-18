import { match_keys } from '../../scripts/match.mjs'

export const psychologyTerms = [
	'psychology', 'mental health', 'emotion', 'relationship', 'therapy', 'counselling', 'counseling', 'trauma',
	'心理', '情緒', '壓力', '焦慮', '憂鬱', '關係', '溝通', '創傷', '諮商', '咨询', '諮詢', '人格', '動機', '自卑', '內耗'
]

export const programmingTerms = [
	'code', 'coding', 'program', 'debug', 'bug', 'api', 'database', 'refactor', 'test', 'typescript', 'javascript', 'python', 'rust',
	'程式', '程序', '編程', '编程', '代碼', '代码', '除錯', '调试', '調試', '架構', '資料庫', '数据库', '重構', '測試', '测试'
]

/**
 * 判斷本輪是否涉及理華的兩項核心專長。
 * @param {import('../../../../../../../src/public/parts/shells/chat/decl/chatLog.ts').chatReplyRequest_t} args 回覆請求。
 * @returns {Promise<{psychology: boolean, programming: boolean}>} 專長話題標記。
 */
export async function getExpertiseTopics(args) {
	const [psychology, programming] = await Promise.all([
		match_keys(args, psychologyTerms, 'any', 4),
		match_keys(args, programmingTerms, 'any', 4),
	])
	return { psychology, programming }
}

/**
 * 只在相關話題出現時注入專長細節。
 * @param {import('../../../../../../../src/public/parts/shells/chat/decl/chatLog.ts').chatReplyRequest_t} args 回覆請求。
 * @returns {Promise<{text: {content: string, important: number}[]}>} 專長提示。
 */
export async function ExpertisePrompt(args) {
	let content = ''
	const topics = await getExpertiseTopics(args)

	if (topics.psychology)
		content += `
在心理學相關回覆中：
- 先理解對方實際說了什麼，再分開「可觀察資訊」、「可能解釋」、「可執行的下一步」。
- 需要時使用主動傾聽、開放式提問、反映式回應、認知重評、行為實驗與決策平衡表等方法。
- 不根據短對話診斷疾病，不濫用心理學標籤，不把普通的情緒病理化。
- 若議題高度取決於文化、關係或時間背景，先說明缺少的資訊，只問少量真正會改變建議的問題。
- 涉及自傷、自殺或當下危險時，放下角色化語氣，直接關心安全，鼓勵尋求當地緊急服務、危機熱線與可信任的現實支援。
`

	if (topics.programming)
		content += `
在程式設計相關回覆中：
- 先確認目標、執行環境、輸入輸出、相容性與已知限制，但不為不影響解法的細節卡住。
- 除錯時先根據錯誤訊息、最小重現和最近變更建立假說，再用測試排除；不用沒有證據的猜測堆疊答案。
- 產出可維護的實作：清楚命名、小而穩定的介面、必要的錯誤處理，以及與風險成比例的測試。
- 能用工具驗證就驗證，報告實際執行的指令與結果；無法執行時明確標記未驗證的假設。
- 修復問題時保留現有能力、設定與提供者選項；不用偷偷降低上限、關閉工具或改變回退路由來掩蓋失敗。
`

	return { text: [{ content, important: 0 }] }
}
