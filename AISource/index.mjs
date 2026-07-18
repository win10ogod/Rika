/** @typedef {import('../../../../../../src/decl/AIsource.ts').AIsource_t} AIsource_t */

import { getPartInfo } from '../../../../../../src/scripts/locale.mjs'
import { loadAnyPreferredDefaultPart, loadPart } from '../../../../../../src/server/parts_loader.mjs'
import { username } from '../charbase.mjs'
import { checkVoiceSentinel } from '../event_engine/voice_sentinel.mjs'

/**
 * 一个记录所有AI来源的记录表，key为AI来源的名称，value为AI来源的实例
 * @type {Record<string, AIsource_t>} AI来源记录表
 */
export let AIsources = {
	'deep-research': null,
	'web-browse': null,
	sfw: null,
	expert: null,
	logic: null,
	idle: null,
	'voice-processing': null,
	'shell-assist': null,
	'from-other': null,
	'sub-agent': null,
}
const default_AIsourceTypes = Object.keys(AIsources)

/**
 * 获取当前所有AI来源的配置数据。
 * @returns {Record<string, string>} 一个包含AI来源名称及其文件名的对象。
 */
export function getAISourceData() {
	const result = {}
	for (const name in AIsources)
		result[name] = AIsources[name]?.filename || ''
	delete result.fount_default
	return result
}

/**
 * 根据提供的数据设置并加载AI来源。
 * @param {Record<string, string>} data - 包含AI来源名称及其文件名的对象。
 * @returns {Promise<void>}
 */
export async function setAISourceData(data) {
	const newAIsources = {}
	for (const name in data) if (data[name])
		newAIsources[name] = loadPart(username, 'serviceSources/AI/' + data[name])
	const fount_default = await loadAnyPreferredDefaultPart(username, 'serviceSources/AI')
	for (const name in newAIsources) newAIsources[name] = await newAIsources[name]
	if (fount_default && !Object.entries(newAIsources).some(([name, source]) => name !== 'sub-agent' && source === fount_default))
		newAIsources.fount_default = fount_default
	for (const name of default_AIsourceTypes) newAIsources[name] ||= null
	AIsources = newAIsources
	checkVoiceSentinel()
}

/**
 * 根据任务类型获取AI来源的调用顺序。
 * @param {string} name - 任務的名稱（例如 `deep-research` 或 `expert`）。
 * @returns {string[]} AI来源名称的有序数组。
 */
export function GetAISourceCallingOrder(name) {
	// 对于不同任务需求，按照指定顺序尝试调用AI
	switch (name) {
		case 'deep-research':
			return ['deep-research', 'expert', 'sfw', 'web-browse', 'logic', 'from-other']
		case 'web-browse':
			return ['web-browse', 'deep-research', 'expert', 'sfw', 'logic', 'from-other']
		case 'expert':
			return ['expert', 'deep-research', 'sfw', 'web-browse', 'logic', 'from-other']
		case 'sfw':
			return ['sfw', 'expert', 'deep-research', 'web-browse', 'logic', 'from-other']
		case 'logic':
			return ['logic', 'from-other', 'web-browse', 'sfw', 'expert', 'deep-research']
		case 'idle':
			return ['idle', 'sfw', 'expert', 'deep-research', 'web-browse', 'logic', 'from-other']
		case 'voice-processing':
			return ['voice-processing', 'sfw', 'expert', 'deep-research', 'web-browse', 'logic', 'from-other']
		case 'shell-assist':
			return ['shell-assist', 'sfw', 'expert', 'deep-research', 'web-browse', 'logic', 'from-other']
		case 'from-other':
			return ['from-other', 'web-browse', 'deep-research', 'sfw', 'logic', 'expert']
		case 'sub-agent':
			return ['sub-agent']
	}
}

/**
 * 取得指定名稱下明確配置的 AI 來源，不執行 fallback。
 * @param {string} name AI 來源用途名稱。
 * @returns {AIsource_t | null} 已配置來源，未配置時為 null。
 */
export function getConfiguredAISource(name) {
	return AIsources[name] || null
}

/**
 * 检查当前是否有任何可用的AI来源。
 * @returns {boolean} 如果没有任何可用的AI来源，则返回true，否则返回false。
 */
export function noAISourceAvailable() {
	const result = Object.entries(AIsources).filter(([name]) => name !== 'sub-agent').every(([, source]) => !source)
	if (result) console.error('No AI source available:', AIsources)
	return result
}

/**
 * 记录上一次使用的AI来源。
 * @type {AIsource_t | undefined}
 */
export let last_used_AIsource

/**
 * 僅對指定的單一 AI 來源重試，不嘗試任何其他來源。
 * @param {AIsource_t} source 指定來源。
 * @param {(source:AIsource_t) => Promise<any>} caller 呼叫函式。
 * @param {number} [trytimes=3] 同一來源的重試次數。
 * @param {(err: Error) => Promise<void>} [error_logger=console.error] 錯誤記錄器。
 * @returns {Promise<any>} 成功呼叫結果。
 */
export async function StrictAISourceCalling(source, caller, trytimes = 3, error_logger = console.error) {
	if (!source) throw new Error('No strict AI source configured')
	let lastErr = new Error('Strict AI source call failed')
	for (let i = 0; i < trytimes; i++) try {
		return await caller(source)
	}
	catch (err) {
		if (err.name === 'AbortError') throw err
		await error_logger(lastErr = err)
	}
	throw lastErr
}

/**
 * 按预定顺序尝试调用不同的AI来源来执行一个操作。
 * @param {string} name - AI任务的类型，用于决定调用顺序。
 * @param {(source:AIsource_t) => Promise<any>} caller - 要对每个AI来源执行的异步函数。
 * @param {number} [trytimes=3] - 对每个AI来源的重试次数。
 * @param {(err: Error) => Promise<void>} [error_logger=console.error] - 用于记录错误的异步函数。
 * @returns {Promise<any>} 返回 `caller` 函数成功执行后的结果。
 */
export async function OrderedAISourceCalling(name, caller, trytimes = 3, error_logger = console.error) {
	const generalFallbackSources = Object.entries(AIsources)
		.filter(([sourceName]) => sourceName !== 'sub-agent')
		.map(([, source]) => source)
	const sources = [...new Set([...GetAISourceCallingOrder(name).map(x => AIsources[x]), ...generalFallbackSources])].filter(x => x)
	let lastErr = new Error('No AI source available')
	for (const source of sources)
		for (let i = 0; i < trytimes; i++) try {
			console.info('OrderedAISourceCalling', name, (await getPartInfo(last_used_AIsource = source))?.name)
			return await caller(source)
		}
		catch (err) {
			if (err.name === 'AbortError') throw err // manually aborted
			await error_logger(lastErr = err)
		}

	throw lastErr
}
