import { App } from '/@/App'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { shallowReactive, set, del, markRaw } from 'vue'
import { Signal } from '/@/components/Common/Event/Signal'
import { Project } from './Project/Project'
import { Title } from '/@/components/Projects/Title'
import type { editor } from 'monaco-editor'
import { BedrockProject } from './Project/BedrockProject'
import { EventDispatcher } from '../Common/Event/EventDispatcher'
import { AnyDirectoryHandle } from '../FileSystem/Types'
import { InformationWindow } from '../Windows/Common/Information/InformationWindow'
import { isUsingFileSystemPolyfill } from '../FileSystem/Polyfill'

export class ProjectManager extends Signal<void> {
	public readonly addedProject = new EventDispatcher<Project>()
	public readonly activatedProject = new EventDispatcher<Project>()
	public readonly state: Record<string, Project> = shallowReactive({})
	public readonly title = markRaw(new Title())
	protected _selectedProject?: string = undefined
	public readonly projectReady = new Signal<void>()

	constructor(protected app: App) {
		super()
		// Only load local projects on PWA builds
		if (!import.meta.env.VITE_IS_TAURI_APP) this.loadProjects()
	}

	get currentProject() {
		if (!this.selectedProject) return null
		return this.state[this.selectedProject]
	}
	get selectedProject() {
		return this._selectedProject
	}
	get totalProjects() {
		return Object.keys(this.state).length
	}

	async getProjects() {
		await this.fired
		return Object.values(this.state)
	}
	getProject(projectName: string): Project | undefined {
		return this.state[projectName]
	}
	async addProject(
		projectDir: AnyDirectoryHandle,
		isNewProject = true,
		requiresPermissions = this.app.bridgeFolderSetup.hasFired,
		select = true
	) {
		const project = new BedrockProject(this, this.app, projectDir, {
			requiresPermissions,
		})

		if (project.name === 'bridge-temp-project') return null

		await project.loadProject()

		if (this.state[project.name] !== undefined) {
			this.state[project.name].deactivate()
			this.state[project.name].dispose()
		}

		set(this.state, project.name, project)

		if (isNewProject) {
			if (select) await this.selectProject(project.name)
			this.addedProject.dispatch(project)
		}

		return project
	}
	async removeProject(project: Project, unlinkProject = true) {
		if (!this.state[project.name])
			throw new Error('Project to delete not found')

		if (this._selectedProject === project.name) {
			await this.deselectCurrentProject()
			project.dispose()
		}

		del(this.state, project.name)
		if (unlinkProject) await this.app.fileSystem.unlink(project.projectPath)

		await this.storeProjects(project.name)
	}
	async removeProjectWithName(projectName: string) {
		const project = this.state[projectName]
		if (!project)
			throw new Error(`Project with name "${projectName}" not found`)

		await this.removeProject(project)
	}

	async loadProjects(requiresPermissions = false) {
		await this.app.fileSystem.fired
		await this.app.dataLoader.fired

		const directoryHandle = await this.app.fileSystem.getDirectoryHandle(
			'projects',
			{ create: true }
		)

		const isBridgeFolderSetup = this.app.bridgeFolderSetup.hasFired

		const promises = []

		// Load existing projects
		for await (const handle of directoryHandle.values()) {
			if (handle.kind !== 'directory') continue

			promises.push(this.addProject(handle, false, requiresPermissions))
		}

		// Only load local projects separately on PWA builds and when the bridge folder was setup
		if (!import.meta.env.VITE_IS_TAURI_APP && isBridgeFolderSetup) {
			const localDirectoryHandle =
				await this.app.fileSystem.getDirectoryHandle(
					'~local/projects',
					{
						create: true,
					}
				)

			// Load local projects as well
			for await (const handle of localDirectoryHandle.values()) {
				if (handle.kind !== 'directory') continue

				promises.push(this.addProject(handle, false, false))
			}
		}

		await Promise.allSettled(promises)

		// Update stored projects in the background (don't await it)
		if (isBridgeFolderSetup) this.storeProjects(undefined, true)

		this.dispatch()
	}

	async deselectCurrentProject() {
		// Clear current comMojangProject
		if (this.app.viewComMojangProject.hasComMojangProjectLoaded) {
			await this.app.viewComMojangProject.clearComMojangProject()
		}

		if (!this.currentProject) return

		await this.currentProject?.deactivate()

		this._selectedProject = undefined
	}

	async selectProject(projectName: string, failGracefully = false) {
		this.deselectCurrentProject()

		if (this._selectedProject === projectName) return true

		if (this.state[projectName] === undefined) {
			if (failGracefully) {
				new InformationWindow({
					description:
						'packExplorer.noProjectView.projectNoLongerExists',
				})
				return false
			}

			throw new Error(
				`Cannot select project "${projectName}" because it no longer exists`
			)
		}

		// Setup com.mojang folder if necessary
		if (!this.app.comMojang.hasFired) this.app.comMojang.setupComMojang()

		this._selectedProject = projectName
		App.eventSystem.dispatch('disableValidation', null)
		this.currentProject?.activate()

		await idbSet('selectedProject', projectName)

		this.app.themeManager.updateTheme()
		App.eventSystem.dispatch('projectChanged', this.currentProject!)

		const projectDatas = await this.loadAvailableProjects()

		console.log(projectDatas, projectName)

		projectDatas.find(
			(project: any) => project.name === projectName
		).lastOpened = Date.now()

		// Store projects in local storage fs
		await this.storeProjects()

		if (!this.projectReady.hasFired) this.projectReady.dispatch()
		return true
	}
	async selectLastProject() {
		await this.fired
		/**
		 * We can select the last selected project if the user is...
		 *
		 * 1. Not using a Tauri native build
		 * 2. Using our file system polyfill
		 *
		 * This is because this variant of bridge. only supports loading one project at once
		 */
		if (
			!import.meta.env.VITE_IS_TAURI_APP &&
			isUsingFileSystemPolyfill.value
		) {
			const selectedProject = await idbGet('selectedProject')
			let didSelectProject = false
			if (typeof selectedProject === 'string')
				didSelectProject = await this.selectProject(
					selectedProject,
					true
				)

			if (didSelectProject) return
		}
	}

	updateAllEditorOptions(options: editor.IEditorConstructionOptions) {
		Object.values(this.state).forEach((project) =>
			project.tabSystems.forEach((tabSystem) =>
				tabSystem.updateOptions(options)
			)
		)
	}

	/**
	 *  Call a function for every current project and projects newly added in the future
	 */
	forEachProject(func: (project: Project) => Promise<void> | void) {
		Object.values(this.state).forEach(func)

		return this.addedProject.on(func)
	}
	/**
	 * Call a function for every project that gets activated
	 */
	onActiveProject(func: (project: Project) => Promise<void> | void) {
		if (this.projectReady.hasFired && this.currentProject)
			func(this.currentProject)

		return this.activatedProject.on(func)
	}
	someProject(func: (project: Project) => boolean) {
		return Object.values(this.state).some(func)
	}

	async recompileAll(forceStartIfActive = true) {
		for (const project of Object.values(this.state))
			await project.recompile(forceStartIfActive)
	}

	async loadAvailableProjects(exceptProject?: string) {
		return (
			await this.app.fileSystem
				.readJSON('~local/data/projects.json')
				.catch(() => [])
		).filter(
			(project: any) =>
				project.name !== 'bridge-temp-project' &&
				(!exceptProject || project.name !== exceptProject)
		)
	}
	async storeProjects(exceptProject?: string, forceRefresh = false) {
		let data: {
			displayName: string
			name: string
			icon?: string
			requiresPermissions: boolean
			isFavorite?: boolean
			lastOpened?: number
		}[] = await this.loadAvailableProjects(exceptProject)

		let newData: any[] = forceRefresh ? [] : [...data]
		Object.values(this.state).forEach((project) => {
			const storedData = data.find(
				(p) =>
					project.name === p.name &&
					project.requiresPermissions === p.requiresPermissions
			)

			if (!forceRefresh && storedData) return

			newData.push({
				name: project.name,
				displayName: project.config.get().name ?? project.name,
				icon: project.projectData.imgSrc,
				requiresPermissions: project.requiresPermissions,
				isFavorite: storedData?.isFavorite ?? false,
				lastOpened: storedData?.lastOpened ?? 0,
			})
		})

		await this.app.fileSystem.writeJSON(
			'~local/data/projects.json',
			newData
		)
		App.eventSystem.dispatch('availableProjectsFileChanged', undefined)
	}
}
