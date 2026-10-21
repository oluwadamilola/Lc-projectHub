import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { routes } from './routes'
import { ThemeProvider } from './theme/ThemeProvider'

// A data router (rather than <BrowserRouter>) is required for the "unsaved changes" navigation guard.
const router = createBrowserRouter(routes)

export default function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}
