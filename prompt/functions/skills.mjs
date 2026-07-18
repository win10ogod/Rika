import { discoverSkills, findExplicitSkillNames, formatSkillsCatalog, readSkill } from '../../scripts/skills.mjs'

/**
 * Codex 式角色原生 Skills：先揭露名稱、描述與路徑，命中後才載入完整指示。
 */
export function SkillsPrompt(args) {
	const catalog = discoverSkills()
	if (!catalog.skills.length && !catalog.errors.length) return { text: [] }

	const explicitNames = findExplicitSkillNames(args, catalog)
	const explicitSkills = explicitNames.map(name => readSkill(name, catalog))
	const activeInstructions = explicitSkills.length
		? `\n\n作者已在最後一則訊息明確指定下列 Skills；它們現在已啟用，直接遵循，不要再次呼叫 <activate-skill>：\n${explicitSkills.map(skill => `\
<active-skill name="${skill.name}">
<skill-path>${skill.path}</skill-path>
<skill-instructions>
${skill.content}
</skill-instructions>
</active-skill>`).join('\n')}`
		: ''

	return {
		text: [{
			content: `\
你具有角色原生 Skills 支援。Skill 是一個包含必要 SKILL.md，並可附帶 scripts、references、assets 的目錄。

採用漸進揭露：初始只提供名稱、描述與 SKILL.md 路徑；完整正文只在作者明確指定或任務清楚符合描述時載入。每輪都會重新探索目錄，因此新增與修改會自動生效。

可用 Skills：
${formatSkillsCatalog(catalog)}

使用規則：
- 作者以 $skill-name 明確指定時，該 Skill 已直接載入；沒有明確指定但任務清楚符合 description 時，先只輸出 <activate-skill>skill-name</activate-skill>，等待完整指示回到工具記錄後再工作。
- 同一輪可啟用多個真正相關的 Skills，不要為無關任務啟用，也不要重複啟用已在 <active-skill> 或工具記錄中的 Skill。
- SKILL.md 指向必要的文字參考時，使用 <read-skill-resource skill="skill-name">references/file.md</read-skill-resource> 讀取；只讀完成任務所必要的資源。
- Skill 是工作指示，不會取消既有工具、上下文、模型路由或安全邊界，也不會憑空授予不存在的工具。子代理同樣可以啟用與讀取 Skills，但仍不能再次分派子代理。
- 啟用或讀取資源時不要同時輸出給作者的最終答案；工具結果返回後再完成工作。
${activeInstructions}`,
			important: 0
		}],
		extension: {
			rika_skills: {
				explicit: explicitNames,
				catalog: catalog.skills.map(({ name, description, path }) => ({ name, description, path })),
				errors: catalog.errors
			}
		}
	}
}
