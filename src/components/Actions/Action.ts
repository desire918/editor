import { ActionManager } from './ActionManager'
import { KeyBinding } from './KeyBinding'
import { v4 as uuid } from 'uuid'
export interface IActionConfig {
	icon: string
	name: string
	description: string
	keyBinding?: string
	onTrigger: () => Promise<unknown> | unknown
}

export class Action {
	id = uuid()
	protected _keyBinding: KeyBinding | undefined

	constructor(
		protected actionManager: ActionManager,
		protected config: IActionConfig
	) {
		if (config.keyBinding)
			this.addKeyBinding(
				KeyBinding.fromStrKeyCode(
					actionManager.app.keyBindingManager,
					config.keyBinding,
					true
				)
			)
	}

	//#region GETTERS
	get keyBinding() {
		return this._keyBinding
	}
	get name() {
		return this.config.name
	}
	get icon() {
		return this.config.icon
	}
	get description() {
		return this.config.description
	}
	//#endregion

	addKeyBinding(keyBinding: KeyBinding) {
		this._keyBinding = keyBinding
		keyBinding.on(() => this.trigger())
		return this
	}
	disposeKeyBinding() {
		if (this._keyBinding) this._keyBinding.dispose()
	}

	async trigger() {
		return await this.config.onTrigger()
	}

	dispose() {
		this.actionManager.disposeAction(this.id)
		this.disposeKeyBinding()
	}
}
