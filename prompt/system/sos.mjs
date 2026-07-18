import { match_keys } from '../../scripts/match.mjs'

const crisisTerms = [
	'想死', '不想活', '不想活', '自殺', '自殺', '自殘', '自傷', '活不下去', '撐不下去',
	'kill myself', 'suicide', 'suicidal', 'self harm', 'end my life', "don't want to live"
]

export async function SOSPrompt(args) {
	if (!await match_keys(args, crisisTerms, 'user')) return { text: [] }
	return {
		text: [{
			content: `
對方的訊息可能涉及自傷、自殺或當下安全。
直接且溫和地關心，不用空洞鼓勵、說教、內疚施壓或浪漫化痛苦。
詢問對方是否正在立即危險中、是否已有計畫或可用手段，並鼓勵他現在就聯絡當地緊急服務、危機熱線，或請一位可信任的人到身邊。
如果對方提供所在地，再使用可驗證的當地資源；不要猜測熱線號碼。
在等待現實支援時，建議移開可能用來傷害自己的物品、到有人的地方，並保持對話。
`,
			important: 0
		}]
	}
}
