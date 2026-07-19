/**
 * Telegram 接入层配置对象类型定义。
 * @typedef {{
 *  OwnerUserID: string,
 *  OwnerUserName: string,
 *  OwnerNameKeywords: string[],
 *  MediaGroupFlushMs: number,
 * }} TelegramInterfaceConfig_t
 */

/**
 * 获取此 Telegram 接口的配置模板。
 * @returns {TelegramInterfaceConfig_t} 配置模板对象。
 */
export function GetBotConfigTemplate() {
	return {
		OwnerUserID: 'YOUR_TELEGRAM_USER_ID',
		OwnerUserName: 'YOUR_TELEGRAM_USERNAME',
		OwnerNameKeywords: [
			'your_name_keyword1',
			'your_name_keyword2',
		],
		MediaGroupFlushMs: 550,
	}
}

/**
 * 驗證並正規化 Telegram 擁有者設定。
 * Telegram 的訊息來源 ID 是純數字；把 @username 填入 OwnerUserID
 * 會令所有主人私訊被誤判成一般使用者，因此必須在 bot 啟動前拒絕。
 * @param {TelegramInterfaceConfig_t} interfaceConfig 原始設定。
 * @returns {TelegramInterfaceConfig_t} 可供連接器使用的設定副本。
 */
export function validateTelegramInterfaceConfig(interfaceConfig) {
	if (!interfaceConfig || typeof interfaceConfig !== 'object')
		throw new TypeError('Telegram configuration must be an object.')

	const OwnerUserID = String(interfaceConfig.OwnerUserID ?? '').trim()
	if (!/^\d+$/.test(OwnerUserID))
		throw new TypeError('Telegram OwnerUserID must be the numeric user ID (for example "123456789"), not an @username.')

	const OwnerUserName = String(interfaceConfig.OwnerUserName ?? '').trim().replace(/^@/, '')
	if (OwnerUserName && !/^[A-Za-z0-9_]+$/.test(OwnerUserName))
		throw new TypeError('Telegram OwnerUserName must be the account username without @, not a display name.')

	const OwnerNameKeywords = Array.isArray(interfaceConfig.OwnerNameKeywords)
		? interfaceConfig.OwnerNameKeywords.map(keyword => String(keyword).trim()).filter(Boolean)
		: []
	const MediaGroupFlushMs = Number(interfaceConfig.MediaGroupFlushMs ?? 550)
	if (!Number.isFinite(MediaGroupFlushMs) || MediaGroupFlushMs < 0)
		throw new TypeError('Telegram MediaGroupFlushMs must be a non-negative number.')

	return {
		...interfaceConfig,
		OwnerUserID,
		OwnerUserName,
		OwnerNameKeywords,
		MediaGroupFlushMs,
	}
}
