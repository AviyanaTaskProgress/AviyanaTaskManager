import jsPDF from 'jspdf';
import { Task, User } from '../types';

export interface ReportFilterOptions {
  month: string;
  year: number;
  department: string;
  userId?: string;
  statusFilter?: string;
}

export function exportMonthlyReportToCSV(
  tasks: Task[],
  users: User[],
  filter: ReportFilterOptions
) {
  const headers = [
    'Task ID',
    'Title',
    'Department',
    'Assignee',
    'Created By',
    'Start Date',
    'Due Date',
    'Status',
    'Priority',
    'Progress (%)',
    'Est. Hours',
    'Logged Hours',
    'Approval Status',
    'Approved By',
  ];

  const rows = tasks.map((t) => [
    `"${t.id}"`,
    `"${t.title.replace(/"/g, '""')}"`,
    `"${t.department}"`,
    `"${t.assigneeName}"`,
    `"${t.createdByName}"`,
    `"${t.startDate}"`,
    `"${t.dueDate}"`,
    `"${t.status}"`,
    `"${t.priority}"`,
    `"${t.progress}"`,
    `"${t.estimatedHours}"`,
    `"${t.loggedHours}"`,
    `"${t.approvalStatus || 'N/A'}"`,
    `"${t.approvedByName || 'N/A'}"`,
  ]);

  const csvContent =
    'data:text/csv;charset=utf-8,' +
    [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute(
    'download',
    `Aviyana_Monthly_Report_${filter.month}_${filter.year}_${filter.department.replace(/\s+/g, '_')}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportMonthlyReportToPDF(
  tasks: Task[],
  users: User[],
  filter: ReportFilterOptions
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 18;

  // Header styling
  doc.setFillColor(30, 41, 59); // Slate-800
  doc.rect(0, 0, pageWidth, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('AVIYANA STAFF WORK REPORT', 14, 12);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(
    `Period: ${filter.month} ${filter.year}  |  Department: ${filter.department}  |  Generated: ${new Date().toLocaleDateString()}`,
    14,
    20
  );

  y = 38;

  // Summary Metrics calculations
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const completionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const totalHours = tasks.reduce((sum, t) => sum + (t.loggedHours || 0), 0);
  const overdueTasks = tasks.filter(
    (t) => t.status !== 'completed' && new Date(t.dueDate) < new Date()
  ).length;

  const relevantUsers =
    filter.department === 'All'
      ? users
      : users.filter((u) => u.department === filter.department);
  const avgProdScore = relevantUsers.length
    ? Math.round(
        relevantUsers.reduce((sum, u) => sum + u.productivityScore, 0) /
          relevantUsers.length
      )
    : 85;

  // Executive Summary Card
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, y, pageWidth - 28, 26, 3, 3, 'FD');

  doc.setTextColor(51, 65, 85);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Monthly Executive Performance Summary', 18, y + 7);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);

  const colWidth = (pageWidth - 36) / 5;
  const metrics = [
    { label: 'Total Tasks', val: `${totalTasks}` },
    { label: 'Completed', val: `${completedTasks} (${completionRate}%)` },
    { label: 'Hours Logged', val: `${totalHours} hrs` },
    { label: 'Avg Productivity', val: `${avgProdScore}/100` },
    { label: 'Overdue Items', val: `${overdueTasks}` },
  ];

  metrics.forEach((m, idx) => {
    const xPos = 18 + idx * colWidth;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(m.val, xPos, y + 15);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(m.label, xPos, y + 21);
  });

  y += 36;

  // Section 1: Team Productivity Breakdown
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('Employee Productivity & Output Matrix', 14, y);
  y += 6;

  // Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, pageWidth - 28, 7, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);

  doc.text('Employee', 16, y + 5);
  doc.text('Role / Department', 65, y + 5);
  doc.text('Done / Assigned', 120, y + 5);
  doc.text('Logged Hrs', 152, y + 5);
  doc.text('Efficiency Score', 175, y + 5);

  y += 9;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  relevantUsers.slice(0, 10).forEach((u, i) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    const userTasks = tasks.filter((t) => t.assigneeId === u.id);
    const userDone = userTasks.filter((t) => t.status === 'completed').length;
    const userHrs = userTasks.reduce((sum, t) => sum + (t.loggedHours || 0), 0);

    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y - 4, pageWidth - 28, 6.5, 'F');
    }

    doc.setTextColor(15, 23, 42);
    doc.text(u.name, 16, y);
    doc.setTextColor(100, 116, 139);
    doc.text(`${u.title} (${u.department.substring(0, 14)})`, 65, y);
    doc.setTextColor(15, 23, 42);
    doc.text(`${userDone} / ${userTasks.length || u.tasksCompleted}`, 120, y);
    doc.text(`${userHrs || u.hoursLoggedThisMonth}h`, 152, y);

    const scoreColor = u.productivityScore >= 85 ? [16, 185, 129] : [59, 130, 246];
    doc.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.text(`${u.productivityScore}%`, 175, y);
    doc.setFont('helvetica', 'normal');

    y += 7;
  });

  y += 6;

  // Section 2: Task Workload & Status Breakdown
  if (y > 230) {
    doc.addPage();
    y = 20;
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('Key Tasks & Priority Tracking', 14, y);
  y += 6;

  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, pageWidth - 28, 7, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);

  doc.text('Task Title', 16, y + 5);
  doc.text('Assignee', 85, y + 5);
  doc.text('Due Date', 125, y + 5);
  doc.text('Priority', 152, y + 5);
  doc.text('Status', 175, y + 5);

  y += 9;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);

  tasks.slice(0, 15).forEach((t, i) => {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y - 4, pageWidth - 28, 6, 'F');
    }
    doc.setTextColor(15, 23, 42);
    doc.text(t.title.length > 40 ? t.title.substring(0, 37) + '...' : t.title, 16, y);
    doc.setTextColor(71, 85, 105);
    doc.text(t.assigneeName, 85, y);
    doc.text(t.dueDate, 125, y);

    // Priority color
    if (t.priority === 'critical') doc.setTextColor(220, 38, 38);
    else if (t.priority === 'high') doc.setTextColor(234, 88, 12);
    else doc.setTextColor(71, 85, 105);
    doc.text(t.priority.toUpperCase(), 152, y);

    doc.setTextColor(15, 23, 42);
    doc.text(t.status.replace('_', ' ').toUpperCase(), 175, y);

    y += 6.5;
  });

  // Footer on all pages
  const pageCount = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Aviyana Ceylon Resort — Staff System • Cryptographically Signed Audit Trail • Page ${i} of ${pageCount}`,
      14,
      doc.internal.pageSize.getHeight() - 8
    );
  }

  doc.save(
    `Aviyana_Monthly_Report_${filter.month}_${filter.year}_${filter.department.replace(/\s+/g, '_')}.pdf`
  );
}
