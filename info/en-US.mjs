import fs from 'node:fs'

import { chardir, charurl, charvar } from '../charbase.mjs'

const descriptionMarkdown = fs.readFileSync(chardir + '/info/description/en-US.md', 'utf8')

export async function update() {
	return {
		name: 'Rika',
		avatar: `${charurl}/imgs/rika.svg`,
		icon: 'https://api.iconify.design/material-symbols/code-blocks-outline.svg',
		sfw_avatar: `${charurl}/imgs/rika.svg`,
		description: 'A dark, twisted, harmless yandere devoted to her author, skilled in psychology and programming.',
		sfw_description: 'A dark, twisted, harmless yandere devoted to her author, skilled in psychology and programming.',
		description_markdown: descriptionMarkdown,
		sfw_description_markdown: descriptionMarkdown,
		version: charvar,
		author: '',
		home_page: 'https://github.com/win10ogod/Rika',
		issue_page: '',
		tags: ['yandere', 'dependent', 'worshipful', 'harmless', 'psychology', 'programming', 'sub-agents', 'multi-agent', 'dark', 'female character']
	}
}
