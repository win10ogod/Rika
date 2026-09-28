import {
	MAX_TIME_PENALTY,
	TIME_DECAY_FACTOR_EXP,
	TIME_OF_DAY_MAX_BONUS,
	TIME_OF_DAY_STD_DEV_MINUTES,
} from './constants.mjs'

/** @typedef {import('./constants.mjs').KeywordInfo} KeywordInfo */
/** @typedef {import('./constants.mjs').MemoryEntry} MemoryEntry */

/** 只辨认明确的数字年份／月份；不从模糊语句猜测事件发生时间。 */
export function explicitMemoryPeriods(text) {
	const periods = new Set()
	for (const match of String(text || '').matchAll(/(?<!\d)(?:19|20)\d{2}(?!\d)(?:年(?:0?[1-9]|1[0-2])月?|[-/.](?:0?[1-9]|1[0-2]))?/g)) {
		const year = match[0].slice(0, 4)
		const month = match[0].slice(4).match(/(?:年|[-/.])(0?[1-9]|1[0-2])(?:月)?/)
		periods.add(month ? `${year}-${month[1].padStart(2, '0')}` : year)
	}
	return [...periods]
}

/** 时间线索只加权，不排除其他记忆；记录时间不必等于事件时间。 */
export function temporalMemoryBonus(memory, period) {
	if (!period) return 0
	const recorded = memory.time_stamp
	const recordedPeriod = recorded instanceof Date && !isNaN(recorded.getTime())
		? `${recorded.getFullYear()}-${String(recorded.getMonth() + 1).padStart(2, '0')}` : ''
	const dates = [...(memory.event_dates || []), recordedPeriod]
	return dates.some(date => period === date || (period.length === 4 && date.startsWith(`${period}-`))) ? 10 : 0
}

/**
 * 计算单个记忆条目的相关性分数。
 * 核心算法包含三个部分：关键词匹配度 + 时间周期性匹配 + 时间衰减。
 *
 * @param {MemoryEntry} memoryEntry - 历史记忆条目
 * @param {KeywordInfo[]} currentKeywords - 当前对话上下文提取的关键词
 * @param {Date} currentTimeStamp - 当前时间戳
 * @returns {number} - 综合相关性分数
 */
export function calculateRelevance(memoryEntry, currentKeywords, currentTimeStamp, requestedPeriod) {
	let relevanceScore = 0

	// 1. 关键词匹配分数
	// 如果当前对话提到的词出现在记忆中，累加双方权重
	const memoryKeywords = new Map(memoryEntry.keywords.map(kw => [kw.word, kw.weight]))
	const focusedWords = new Set()
	for (const kw of memoryEntry.focus_keywords || []) {
		focusedWords.add(kw.word)
		memoryKeywords.set(kw.word, Math.max(memoryKeywords.get(kw.word) || 0, kw.weight))
	}
	let keywordMatchScore = 0
	currentKeywords.forEach(currentKw => {
		if (memoryKeywords.has(currentKw.word))
			keywordMatchScore += currentKw.weight + memoryKeywords.get(currentKw.word) + (focusedWords.has(currentKw.word) ? 2 : 0)
	})
	relevanceScore += keywordMatchScore

	// 2. 时间周期性加成 (Time of Day Bonus)
	// 计算当前时间与记忆时间在一天中的分钟数差异
	const memoryTime = memoryEntry.time_stamp
	const currentTime = currentTimeStamp
	const memoryMinutes = memoryTime.getHours() * 60 + memoryTime.getMinutes()
	const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes()
	const totalMinutesInDay = 24 * 60

	// 计算循环时间差（例如 23:00 和 01:00 差2小时而不是22小时）
	let timeOfDayDiff = Math.abs(memoryMinutes - currentMinutes)
	if (timeOfDayDiff > totalMinutesInDay / 2)
		timeOfDayDiff = totalMinutesInDay - timeOfDayDiff

	// 使用高斯函数（正态分布曲线）计算加成，差异越小加成越高
	const numerator = -(timeOfDayDiff * timeOfDayDiff)
	const denominator = 2 * TIME_OF_DAY_STD_DEV_MINUTES * TIME_OF_DAY_STD_DEV_MINUTES
	const timeOfDayBonus = TIME_OF_DAY_MAX_BONUS * Math.exp(numerator / denominator)
	relevanceScore += timeOfDayBonus

	// 3. 时间衰减惩罚 (Time Decay Penalty)
	// 记忆越久远，扣分越多（模拟遗忘），但有最大扣分上限
	const timeDiff = Math.max(0, currentTimeStamp.getTime() - (memoryEntry.time_stamp?.getTime() ?? 0))
	const timePenalty = MAX_TIME_PENALTY * (1 - Math.exp(-timeDiff * TIME_DECAY_FACTOR_EXP))
	relevanceScore -= timePenalty

	// 4. 明确的时间请求优先于单纯新近度；不把不匹配者从检索中剔除。
	relevanceScore += temporalMemoryBonus(memoryEntry, requestedPeriod)

	// 5. 加上记忆本身的固有分数（被引用过的记忆分数会更高）
	relevanceScore += memoryEntry.score

	return relevanceScore
}

/**
 * 加权随机选择算法。
 * 用于"随机回闪"功能，让分数高或较新的记忆更有可能被随机选中。
 * @template T
 * @param {T[]} items - 待选择项数组
 * @param {number[]} weights - 对应各项的权重
 * @returns {T | null} - 选中的项
 */
export function selectOneWeightedRandom(items, weights) {
	if (!items?.length || items.length !== weights.length)
		return null

	const totalWeight = weights.reduce((sum, w) => sum + Math.max(0, w), 0)
	// 权重总和无效时，退化为均匀随机
	if (totalWeight <= 0)
		if (items.length)
			return items[Math.floor(Math.random() * items.length)]
		else
			return null

	const randomVal = Math.random() * totalWeight
	let cumulativeWeight = 0

	for (let i = 0; i < items.length; i++) {
		const weight = Math.max(0, weights[i])
		cumulativeWeight += weight
		if (randomVal <= cumulativeWeight)
			return items[i]
	}

	return items[items.length - 1]
}
