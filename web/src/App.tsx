import { Navigate, Route, Routes } from 'react-router-dom';
import { ApplicationPage, ApplicationsPage, IntakesPage } from './pages/AdmissionsPages';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { StaffPage, StudentsPage, UsersPage } from './pages/PeoplePages';
import { EnrolmentsPage, NoticesPage, TermsPage } from './pages/RecordsPages';
import { CoursesPage, DepartmentsPage, ProgrammesPage } from './pages/StructurePages';
import { AttendancePage, GradebookPage, RegistrationPage, ResultsPage, SetupPage, StudentRecordPage } from './pages/WorkspacePages';
import { Shell } from './ui';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Shell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/intakes" element={<IntakesPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/applications/:id" element={<ApplicationPage />} />
        <Route path="/departments" element={<DepartmentsPage />} />
        <Route path="/programmes" element={<ProgrammesPage />} />
        <Route path="/courses" element={<CoursesPage />} />
        <Route path="/students" element={<StudentsPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/enrollments" element={<EnrolmentsPage />} />
        <Route path="/announcements" element={<NoticesPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/registration" element={<RegistrationPage />} />
        <Route path="/gradebook" element={<GradebookPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/students/record" element={<StudentRecordPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
