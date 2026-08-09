import { render } from 'preact'
import './style.css'
import { t } from './i18n'
import { App } from './ui/App'

document.title = t('app.title')

const root = document.getElementById('root')
if (!root) throw new Error('index.html: #root puuttuu')
render(<App />, root)
