import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'

// Public
import Landing from './pages/Landing.jsx'
import Pricing from './pages/Pricing.jsx'
import Signup from './pages/Signup.jsx'
import Login from './pages/Login.jsx'

// Onboarding
import Workspace from './pages/onboarding/Workspace.jsx'
import BusinessMemory from './pages/onboarding/BusinessMemory.jsx'
import Sender from './pages/onboarding/Sender.jsx'
import Domain from './pages/onboarding/Domain.jsx'
import Done from './pages/onboarding/Done.jsx'

// App
import Dashboard from './pages/Dashboard.jsx'
import Leads from './pages/Leads.jsx'
import LeadProfile from './pages/LeadProfile.jsx'
import Campaigns from './pages/Campaigns.jsx'
import NewCampaign from './pages/NewCampaign.jsx'
import Setup from './pages/manual/Setup.jsx'
import Senders from './pages/manual/Senders.jsx'
import Template from './pages/manual/Template.jsx'
import Sequence from './pages/manual/Sequence.jsx'
import Preview from './pages/manual/Preview.jsx'
import Launched from './pages/manual/Launched.jsx'
import AiBuilder from './pages/ai/AiBuilder.jsx'
import AiSummary from './pages/ai/AiSummary.jsx'
import Templates from './pages/Templates.jsx'
import Inbox from './pages/Inbox.jsx'
import Analytics from './pages/Analytics.jsx'
import Settings from './pages/Settings.jsx'
import Admin from './pages/Admin.jsx'
import LeadListDetail from './pages/LeadListDetail.jsx'
import Docs from './pages/Docs.jsx'

export default function App() {
  return (
    <Routes>
      {/* Public / auth — no app shell */}
      <Route path="/" element={<Landing />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/login" element={<Login />} />

      {/* Onboarding — own slim shell */}
      <Route path="/onboarding/workspace" element={<Workspace />} />
      <Route path="/onboarding/business-memory" element={<BusinessMemory />} />
      <Route path="/onboarding/sender" element={<Sender />} />
      <Route path="/onboarding/domain" element={<Domain />} />
      <Route path="/onboarding/done" element={<Done />} />

      {/* Signed-in app — persistent shell */}
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/leads" element={<Leads />} />
        <Route path="/leads/import" element={<Leads />} />
        <Route path="/leads/lists/:id" element={<LeadListDetail />} />
        <Route path="/leads/:id" element={<LeadProfile />} />

        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/campaigns/new" element={<NewCampaign />} />
        <Route path="/campaigns/new/setup" element={<Setup />} />
        <Route path="/campaigns/new/senders" element={<Senders />} />
        <Route path="/campaigns/new/template" element={<Template />} />
        <Route path="/campaigns/new/sequence" element={<Sequence />} />
        <Route path="/campaigns/new/preview" element={<Preview />} />
        <Route path="/campaigns/launched" element={<Launched />} />
        <Route path="/campaigns/new/ai" element={<AiBuilder />} />
        <Route path="/campaigns/new/ai/summary" element={<AiSummary />} />
        <Route path="/campaigns/:id" element={<Analytics />} />

        <Route path="/templates" element={<Templates />} />
        <Route path="/templates/editor" element={<Template />} />

        <Route path="/inbox" element={<Inbox />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/docs" element={<Docs />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
