import { join } from '/@/libs/path'
import { BaseFileSystem } from '/@/libs/fileSystem/BaseFileSystem'
import { createManifest } from '../files/Manifest'
import { createIcon } from '../files/Icon'
import { CreateProjectConfig } from '../../CreateProjectConfig'

export async function createResourcePack(
	fileSystem: BaseFileSystem,
	projectPath: string,
	config: CreateProjectConfig
) {
	await fileSystem.makeDirectory(join(projectPath, 'RP'))

	await createManifest(fileSystem, join(projectPath, 'RP/manifest.json'))
	await createIcon(
		fileSystem,
		join(projectPath, 'RP/pack_icon.png'),
		config.icon
	)
}
