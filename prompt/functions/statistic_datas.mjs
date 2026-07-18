import { match_keys } from '../../scripts/match.mjs'
import { statisticDatas } from '../../scripts/statistics.mjs'
import { parseDuration, timeToStr, timeToTimeStr } from '../../scripts/tools.mjs'

export async function StatisticDatasPrompt(args) {
	let result = ''
	const forced = args.extension?.enable_prompts?.statisticDatas

	if (forced || await match_keys(args, ['第一次', '多久']))
		result += `
你們第一次對話是在 ${statisticDatas.firstInteraction.chat_name} 的 ${timeToStr(statisticDatas.firstInteraction.time, 'zh-CN')}，距今 ${timeToTimeStr(Date.now() - statisticDatas.firstInteraction.time, 'zh-CN')}。
使用者的第一則訊息：
${statisticDatas.firstInteraction.userMessageContent}
你的回覆：
${statisticDatas.firstInteraction.characterReplyContent}
`

	if (forced || await match_keys(args, ['多少次', '多少條', '多少条']))
		result += `
使用者累計傳送 ${statisticDatas.userActivity.totalMessagesSent} 則訊息、${statisticDatas.userActivity.totalStatementsSent} 個句子。
你累計回覆 ${statisticDatas.characterActivity.totalMessagesSent} 次、${statisticDatas.characterActivity.totalStatementsSent} 個句子。
工具使用次數：程式執行 ${statisticDatas.toolUsage.codeRuns}、深度研究 ${statisticDatas.toolUsage.deepResearchSessions}、子代理分派 ${statisticDatas.toolUsage.subAgentDelegations || 0}、檔案操作 ${statisticDatas.toolUsage.fileOperations}、網路搜尋 ${statisticDatas.toolUsage.webSearches}、網頁瀏覽 ${statisticDatas.toolUsage.webBrowses}、計時器 ${statisticDatas.toolUsage.timersSet}。
`

	if ((forced || await match_keys(args, ['最長', '最长'])) &&
		statisticDatas.longestDailyChat.end - statisticDatas.longestDailyChat.start > parseDuration('48h'))
		result += `
最長的每日連續對話期間從 ${timeToStr(statisticDatas.longestDailyChat.start, 'zh-CN')} 到 ${timeToStr(statisticDatas.longestDailyChat.end, 'zh-CN')}，約 ${timeToTimeStr(statisticDatas.longestDailyChat.end - statisticDatas.longestDailyChat.start, 'zh-CN')}。
`

	if (forced || await match_keys(args, ['token', 'tokens', '平均']))
		result += `
每次請求的平均 token 數約為 ${statisticDatas.avgTokenNum}。
`

	return { text: [{ content: result, important: 0 }] }
}
