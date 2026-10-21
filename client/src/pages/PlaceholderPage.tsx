import { useLocation } from 'react-router-dom'
import { navItems } from '../data/navigation'

export function PlaceholderPage() {
  const { pathname } = useLocation()
  const item = navItems.find((nav) => nav.path === pathname)

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{item?.label ?? 'Page not found'}</h1>
          <p>{item?.description ?? 'This page does not exist.'}</p>
        </div>
      </div>
      <section className="card placeholder" aria-label="Coming soon">
        <h2>Coming soon</h2>
        <p>
          {item
            ? 'This section is part of the planned build and has not been developed yet.'
            : 'Use the navigation to return to a section of LC ProjectHub.'}
        </p>
      </section>
    </>
  )
}
