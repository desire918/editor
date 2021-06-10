import { createTree } from './createTree'
import { Tree, treeElementHeight } from './Tree'
import ArrayTreeComponent from './CommonTree.vue'
import type { ObjectTree } from './ObjectTree'

export class ArrayTree extends Tree<Array<unknown>> {
	public component = ArrayTreeComponent
	public _isOpen = false
	public readonly type = 'array'
	protected _children: Tree<unknown>[]

	constructor(
		parent: ObjectTree | ArrayTree | null,
		protected _value: Array<unknown>
	) {
		super(parent)
		this._children = _value.map((val) => createTree(this, val))
	}

	get height() {
		if (!this.isOpen) return treeElementHeight

		return (
			2 * treeElementHeight +
			this._children.reduce((prev, val) => prev + val.height, 0)
		)
	}
	get children() {
		return this._children
	}
	get hasChildren() {
		return this._children.length > 0
	}
	get isOpen() {
		if (!this.hasChildren) return false
		return this._isOpen
	}

	hasChild(child: Tree<unknown>) {
		return this.children.includes(child)
	}

	setOpen(val: boolean) {
		if (this.hasChildren) this._isOpen = val
	}
	toggleOpen() {
		this.setOpen(!this._isOpen)
	}

	toJSON() {
		return this._children.map((child) => child.toJSON())
	}
	updatePropertyName(oldIndex: number, newIndex: number) {
		let oldTree = this.children[oldIndex]
		let newTree = this.children[newIndex]
		this.children[newIndex] = oldTree
		delete this.children[oldIndex]

		return {
			undo: () => {
				this.children[oldIndex] = oldTree
				this.children[newIndex] = newTree
			},
		}
	}
}
