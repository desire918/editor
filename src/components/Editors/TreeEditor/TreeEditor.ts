import { ActionManager } from '/@/components/Actions/ActionManager'
import { KeyBindingManager } from '/@/components/Actions/KeyBindingManager'
import { EventDispatcher } from '/@/components/Common/Event/EventDispatcher'
import { FileType } from '/@/components/Data/FileType'
import { SchemaManager } from '/@/components/JSONSchema/Manager'
import { RootSchema } from '/@/components/JSONSchema/Schema/Root'
import { ICompletionItem } from '/@/components/JSONSchema/Schema/Schema'
import { UndoDeleteEntry } from './History/DeleteEntry'
import { EditorHistory } from './History/EditorHistory'
import { HistoryEntry } from './History/HistoryEntry'
import { ReplaceTreeEntry } from './History/ReplaceTree'
import { TreeTab } from './Tab'
import { ArrayTree } from './Tree/ArrayTree'
import { createTree } from './Tree/createTree'
import { ObjectTree } from './Tree/ObjectTree'
import { PrimitiveTree } from './Tree/PrimitiveTree'
import type { TPrimitiveTree, Tree } from './Tree/Tree'
import { TreeSelection, TreeValueSelection } from './TreeSelection'
import { App } from '/@/App'

export class TreeEditor {
	public propertySuggestions: ICompletionItem[] = []
	public valueSuggestions: string[] = []

	protected tree: Tree<unknown>
	protected selections: (TreeSelection | TreeValueSelection)[] = []
	protected _keyBindings: KeyBindingManager | undefined
	protected _actions: ActionManager | undefined
	protected history = new EditorHistory(this)
	protected schemaRoot?: RootSchema
	protected selectionChange = new EventDispatcher<void>()

	get keyBindings() {
		if (!this._keyBindings)
			throw new Error(
				`Cannot access keyBindings before they were initialized.`
			)

		return this._keyBindings
	}
	get actions() {
		if (!this._actions)
			throw new Error(
				`Cannot access keyBindings before they were initialized.`
			)

		return this._actions
	}

	constructor(protected parent: TreeTab, protected json: unknown) {
		this.tree = createTree(null, json)
		this.setSelection(this.tree)

		this.history.on((isUnsaved) => {
			this.parent.setIsUnsaved(isUnsaved)
		})
		this.history.changed.on(() => {
			this.propertySuggestions = []
			this.valueSuggestions = []

			this.parent.updateCache()
		})

		App.getApp().then(async (app) => {
			await app.projectManager.projectReady.fired

			this.parent.once(() => {
				if (app.project.jsonDefaults.isReady) this.createSchemaRoot()
			})

			app.project.jsonDefaults.on(() => {
				if (this.parent.hasFired) this.createSchemaRoot()
			})
		})

		this.selectionChange.on(() => this.updateSuggestions())
	}

	updateSuggestions() {
		this.propertySuggestions = []
		this.valueSuggestions = []

		const tree = <ArrayTree | ObjectTree | undefined>this.selections
			.find((sel) => {
				const type = sel.getTree().type
				return type === 'object' || type === 'array'
			})
			?.getTree()
		const json = tree?.toJSON()

		let suggestions: ICompletionItem[] = []
		if (this.selections.length === 0 || tree === this.tree) {
			suggestions = this.schemaRoot?.getCompletionItems(json) ?? []
		} else if (tree) {
			const treePath = tree.path
			const schemas = this.schemaRoot?.getSchemasFor(treePath)

			if (schemas)
				suggestions = schemas
					.filter((schema) => schema !== undefined)
					.map((schema) => schema.getCompletionItems(json))
					.flat()
		}

		this.propertySuggestions = suggestions.filter(
			(suggestion) =>
				(suggestion.type === 'object' || suggestion.type === 'array') &&
				!(<any>(tree ?? this.tree)).children.find((test: any) => {
					if (test.type === 'array') return false
					return test[0] === suggestion.value
				})
		)

		// Only suggest values for empty objects
		if ((tree?.children?.length ?? 1) === 0) {
			this.valueSuggestions = suggestions
				.filter((suggestion) => suggestion.type === 'value')
				.map((suggestion) => `${suggestion.value}`)
		}
	}

	createSchemaRoot() {
		const schemaUri = FileType.get(this.parent.getProjectPath())?.schema
		if (schemaUri)
			this.schemaRoot = SchemaManager.addRootSchema(
				schemaUri,
				new RootSchema(
					schemaUri,
					'$global',
					SchemaManager.request(schemaUri)
				)
			)
		this.updateSuggestions()
	}

	receiveContainer(container: HTMLDivElement) {
		this._actions?.dispose()
		this._keyBindings = new KeyBindingManager(container)
		this._actions = new ActionManager(this._keyBindings)

		this.actions.create({
			keyBinding: ['DELETE', 'BACKSPACE'],
			prevent: (el) => {
				if (el.tagName === 'INPUT' && (<any>el).value === '')
					return false
				return el.tagName !== 'SUMMARY' && el.tagName !== 'DIV'
			},
			onTrigger: () => {
				const entries: HistoryEntry[] = []

				this.forEachSelection((sel) => {
					const tree = sel.getTree()
					if (!tree.getParent()) return // May not delete global tree

					if (
						sel instanceof TreeValueSelection &&
						tree.getParent()!.type === 'object'
					) {
						// A delete action on a primitive value replaces the PrimitiveTree with an emtpy ObjectTree
						const newTree = new ObjectTree(tree.getParent(), {})
						this.toggleSelection(newTree)

						tree.replace(newTree)

						entries.push(new ReplaceTreeEntry(tree, newTree))
					} else {
						this.toggleSelection(tree.getParent()!)

						const [index, key] = tree.delete()

						entries.push(new UndoDeleteEntry(tree, index, key))
					}

					sel.dispose()
				})

				this.history.pushAll(entries)
			},
		})

		this.actions.create({
			keyBinding: ['ESCAPE'],
			onTrigger: () => {
				this.setSelection(this.tree)
			},
		})

		this.actions.create({
			keyBinding: ['CTRL + Z'],
			onTrigger: () => {
				this.history.undo()
			},
		})

		this.actions.create({
			keyBinding: ['CTRL + Y'],
			onTrigger: () => {
				this.history.redo()
			},
		})
	}

	saveState() {
		this.history.saveState()
	}

	toJSON() {
		return this.tree.toJSON()
	}

	forEachSelection(
		cb: (selection: TreeSelection | TreeValueSelection) => void
	) {
		this.selections.forEach(cb)
	}

	removeSelection(selection: TreeSelection | TreeValueSelection) {
		this.selections = this.selections.filter((sel) => selection !== sel)
		this.selectionChange.dispatch()
	}
	removeSelectionOf(tree: Tree<unknown>) {
		this.selections = this.selections.filter((sel) => {
			const currTree = sel.getTree()
			if (
				currTree !== tree &&
				(tree instanceof PrimitiveTree ||
					!(<ObjectTree | ArrayTree>tree).hasChild(currTree))
			)
				return true

			sel.dispose(false)
			return false
		})
		this.selectionChange.dispatch()
	}

	setSelection(tree: Tree<unknown>, selectPrimitiveValue = false) {
		this.selections.forEach((selection) => selection.dispose(false))
		this.selections = [
			selectPrimitiveValue && tree instanceof PrimitiveTree
				? new TreeValueSelection(this, tree)
				: new TreeSelection(this, <ArrayTree | ObjectTree>tree),
		]
		this.selectionChange.dispatch()
	}
	toggleSelection(tree: Tree<unknown>, selectPrimitiveValue = false) {
		let didRemoveSelection = false
		this.selections = this.selections.filter((selection) => {
			if (
				selection.getTree() !== tree ||
				selection instanceof TreeValueSelection !== selectPrimitiveValue
			)
				return true

			selection.dispose(false)
			didRemoveSelection = true
			return false
		})

		if (!didRemoveSelection)
			this.selections.push(
				selectPrimitiveValue && tree instanceof PrimitiveTree
					? new TreeValueSelection(this, tree)
					: new TreeSelection(this, <ArrayTree | ObjectTree>tree)
			)
		this.selectionChange.dispatch()
	}

	addKey(value: string, type: 'array' | 'object') {
		const entries: HistoryEntry[] = []

		this.forEachSelection((selection) => {
			if (selection instanceof TreeValueSelection) return

			entries.push(selection.addKey(value, type))
		})

		this.history.pushAll(entries)
	}

	addValue(value: string) {
		let transformedValue: TPrimitiveTree = value
		if (!Number.isNaN(Number(value))) transformedValue = Number(value)
		else if (value === 'null') transformedValue = null
		else if (value === 'true' || value === 'false')
			transformedValue = value === 'true'

		const entries: HistoryEntry[] = []

		this.forEachSelection((selection) => {
			if (selection instanceof TreeValueSelection) return

			const entry = selection.addValue(transformedValue)
			if (entry) entries.push(entry)
		})

		this.history.pushAll(entries)
	}
}
