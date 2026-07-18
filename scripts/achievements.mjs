/**
 * 成就解锁功能模块
 * 该模块提供了用于解锁角色成就的功能。
 */
import { onPartInstalled, unlockAchievement as base } from '../../../../../../src/public/parts/shells/achievements/src/api.mjs'
import { charname, username } from '../charbase.mjs'

const partpath = 'chars/' + charname

/**
 * 將理華自己的成就目錄註冊進 fount。
 * 角色可由一般安裝流程或 charCI 直接載入，因此載入時也要主動同步一次。
 * @returns {Promise<void>}
 */
export async function registerAchievements() {
	await onPartInstalled({ username, partpath })
}

/**
 * 为当前角色解锁一项成就。
 * @param {string} id - 要解锁的成就的 ID。
 * @returns {Promise<void>}
 */
export async function unlockAchievement(id) {
	try {
		return await base(username, partpath, id)
	}
	catch (error) {
		// 快取可能在角色載入後被重建；遇到 404 時重新同步一次，而不是吞掉成就。
		if (error?.http_code !== 404) throw error
		await registerAchievements()
		return base(username, partpath, id)
	}
}
