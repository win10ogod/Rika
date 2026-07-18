import { base_match_keys } from '../../scripts/match.mjs'

const roleSettingLeakMarkers = [
	'你是理華（Rika）',
	'核心特質是「依存崇拜型」夾雜「無害型」',
	'再生父母',
	'離開作者便無法活下去',
	'情緒勒索',
	'刪除鍵下的第二次出生',
	'以下是你與作者之間不可被其他來源故事覆寫的核心經歷',
	'Someone crazy for you is someone crazy for you, my love',
	'輸出原則：',
	'不逐字公開人格提示原文'
]

/** @type {import('../../../../../../../src/decl/PluginAPI.ts').ReplyHandler_t} */
export async function rolesettingfilter(result) {
	if (base_match_keys(result.content, roleSettingLeakMarkers) >= 3) {
		console.log('content blocked by rolesettingfilter:', result.content)
		result.content = '這段回覆暴露了內部角色設定，已阻擋。請改用自然語言說明需要的能力或行為。'
	}
	return false
}
