import { basename, join } from '/@/libs/path'
import { App } from '/@/App'
import { defaultPackPaths, IConfigJson } from 'mc-project-core'
import { ProjectData } from '../data/ProjectData'
import { TextTab } from '/@/components/Editor/Tabs/Text/TextTab'

export interface ProjectInfo {
	name: string
	icon: string
	config: IConfigJson
}

export class Project {
	public path: string
	public icon: string | null = null
	public packs: string[] = []

	constructor(public name: string, public data: ProjectData) {
		this.path = join('projects', this.name)
	}

	public async load() {
		const projectInfo = await getProjectInfo(join('projects', this.name))

		this.icon = projectInfo.icon
		this.packs = Object.keys(projectInfo.config.packs)

		await this.data.load()
	}

	public openFile(path: string) {
		console.log('Opening file:', path)

		App.instance.tabManager.openTab(new TextTab())
	}
}

export async function validProject(path: string) {
	const fileSystem = App.instance.fileSystem

	return await fileSystem.exists(join(path, 'config.json'))
}

export async function getProjectInfo(path: string): Promise<ProjectInfo> {
	const fileSystem = App.instance.fileSystem

	let iconDataUrl =
		'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

	if (
		await fileSystem.exists(
			join(path, defaultPackPaths['behaviorPack'], 'pack_icon.png')
		)
	)
		iconDataUrl = await fileSystem.readFileDataUrl(
			join(path, 'BP', 'pack_icon.png')
		)

	if (
		await fileSystem.exists(
			join(path, defaultPackPaths['resourcePack'], 'pack_icon.png')
		)
	)
		iconDataUrl = await fileSystem.readFileDataUrl(
			join(path, 'BP', 'pack_icon.png')
		)

	if (
		await fileSystem.exists(
			join(path, defaultPackPaths['skinPack'], 'pack_icon.png')
		)
	)
		iconDataUrl = await fileSystem.readFileDataUrl(
			join(path, 'BP', 'pack_icon.png')
		)

	return {
		name: basename(path),
		icon: iconDataUrl,
		config: await fileSystem.readFileJson(join(path, 'config.json')),
	}
}
