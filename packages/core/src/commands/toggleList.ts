import { NodeType } from '@tiptap/pm/model'
import { Transaction } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'

import { findParentNode } from '../helpers/findParentNode'
import { getActiveSplittableMarks } from '../helpers/getActiveSplittableMarks'
import { getNodeType } from '../helpers/getNodeType'
import { isList } from '../helpers/isList'
import { RawCommands } from '../types'

const joinListBackwards = (tr: Transaction, listType: NodeType): boolean => {
  const list = findParentNode(node => node.type === listType)(tr.selection)

  if (!list) {
    return true
  }

  const before = tr.doc.resolve(Math.max(0, list.pos - 1)).before(list.depth)

  if (before === undefined) {
    return true
  }

  const nodeBefore = tr.doc.nodeAt(before)
  const canJoinBackwards = list.node.type === nodeBefore?.type && canJoin(tr.doc, list.pos)

  if (!canJoinBackwards) {
    return true
  }

  tr.join(list.pos)

  return true
}

const joinListForwards = (tr: Transaction, listType: NodeType): boolean => {
  const list = findParentNode(node => node.type === listType)(tr.selection)

  if (!list) {
    return true
  }

  const after = tr.doc.resolve(list.start).after(list.depth)

  if (after === undefined) {
    return true
  }

  const nodeAfter = tr.doc.nodeAt(after)
  const canJoinForwards = list.node.type === nodeAfter?.type && canJoin(tr.doc, after)

  if (!canJoinForwards) {
    return true
  }

  tr.join(after)

  return true
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggleList: {
      /**
       * Toggle between different list types.
       */
      toggleList: (listTypeOrName: string | NodeType, itemTypeOrName: string | NodeType, keepMarks?: boolean, attributes?: Record<string, any>) => ReturnType;
    }
  }
}

export const toggleList: RawCommands['toggleList'] = (listTypeOrName, itemTypeOrName, keepMarks, attributes = {}) => ({
  editor, tr, state, dispatch, chain, commands, can,
}) => {
  const { extensions } = editor.extensionManager
  const listType = getNodeType(listTypeOrName, state.schema)
  const itemType = getNodeType(itemTypeOrName, state.schema)
  const { selection } = state
  const { $from, $to } = selection
  const range = $from.blockRange($to)
  const activeSplittableMarks = getActiveSplittableMarks(state, editor.extensionManager)

  if (!range) {
    return false
  }

  const parentList = findParentNode(node => isList(node.type.name, extensions))(selection)

  if (range.depth >= 1 && parentList && range.depth - parentList.depth <= 1) {
    // remove list
    if (parentList.node.type === listType) {
      return commands.liftListItem(itemType)
    }

    // change list type
    if (
      isList(parentList.node.type.name, extensions)
        && listType.validContent(parentList.node.content)
        && dispatch
    ) {
      return chain()
        .command(() => {
          tr.setNodeMarkup(parentList.pos, listType)

          return true
        })
        .command(() => joinListBackwards(tr, listType))
        .command(() => joinListForwards(tr, listType))
        .run()
    }
  }

  let baseCommandChain = chain()
    // try to convert node to default node if needed
    .command(() => {
      const canWrapInList = can().wrapInList(listType, attributes)

      if (canWrapInList) {
        return true
      }

      return commands.clearNodes()
    })
    .wrapInList(listType, attributes)
    .command(() => joinListBackwards(tr, listType))
    .command(() => joinListForwards(tr, listType))

  if (keepMarks && activeSplittableMarks.length && dispatch) {
    baseCommandChain = baseCommandChain.command(() => {
      tr.ensureMarks(activeSplittableMarks)
      return true
    })

  }
  return baseCommandChain.run()
}
