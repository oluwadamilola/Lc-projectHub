import { fireEvent, screen, within } from '@testing-library/react'

/** The "⋮" button of a task row. */
export const actionsButton = (row: HTMLElement) => within(row).getByRole('button', { name: /^Actions for task / })

/** Opens a row's actions menu and chooses an action, the way a person would with a mouse. */
export function chooseRowAction(row: HTMLElement, action: 'Edit task' | 'Delete task') {
  fireEvent.click(actionsButton(row))
  fireEvent.click(screen.getByRole('menuitem', { name: action }))
}
