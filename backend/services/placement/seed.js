// ============================================================================
// Placement desk — demo data (Settings → Placement → "Load demo data").
// ============================================================================
// About 10 clients, 28 openings, 180 candidates, ~320 pipeline rows, interviews,
// offers, joinings, invoices and deployed contract staff, spread over the last
// three months and counted back from today, so the dashboard always looks live.
//
// Everything made here is marked (is_demo, the tag "placement-demo" on the
// companies, the user names "pl.demo.*") so "Remove demo data" takes out
// exactly this and nothing the team entered themselves. The same data comes
// out every time: the generator below is seeded.
// ============================================================================
const db = require('../../db');
const S = require('./store');

const TAG = 'placement-demo';
const bad = S.bad;

// ------------------------------- a steady random ---------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20261016);
const pick = (a) => a[Math.floor(R() * a.length)];
const between = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
const chance = (p) => R() < p;
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i -= 1) { const j = Math.floor(R() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const r1 = (x) => Math.round(x * 10) / 10;

const dayAgo = (n) => S.today(-n);
const stamp = (daysAgo, h, m) => `${dayAgo(daysAgo)} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const workTime = () => [between(10, 18), pick([0, 10, 15, 30, 40, 45])];

// ------------------------------- the data ----------------------------------
const RECRUITERS = ['Priya Nair', 'Rohit Verma', 'Sneha Kulkarni', 'Imran Shaikh', 'Anjali Mehta'];

// name, city, industry, agreement, fee %, terms, guarantee, spoc, phone, email domain
const CLIENTS = [
  ['Zenith Software Pvt Ltd', 'Pune', 'IT Services', 'Permanent', 8.33, 'Net 30', 90, 'Rahul Deshmukh', '9822011450', 'zenithsoft.example.com'],
  ['Orbit Fintech', 'Mumbai', 'Fintech', 'Permanent', 10, 'Net 30', 90, 'Meera Iyer', '9820044120', 'orbitfintech.example.com'],
  ['Medora Healthcare', 'Bengaluru', 'Healthcare', 'Permanent', 8.33, 'Net 45', 60, 'Dr. Suresh Rao', '9886012233', 'medora.example.com'],
  ['Kavach Auto Components', 'Chennai', 'Manufacturing', 'Permanent', 8.33, 'Net 30', 45, 'Karthik Subramanian', '9840177812', 'kavachauto.example.com'],
  ['Nimbus Retail', 'Gurugram', 'Retail & E-commerce', 'Permanent', 8.33, 'Net 15', 90, 'Nidhi Kapoor', '9810056677', 'nimbusretail.example.com'],
  ['Altura Infra Projects', 'Hyderabad', 'Infrastructure', 'Both', 8.33, 'Net 45', 120, 'Venkat Reddy', '9848099001', 'alturainfra.example.com'],
  ['Pranav Logistics', 'Ahmedabad', 'Logistics', 'Permanent', 8.33, 'Net 30', 90, 'Jignesh Patel', '9824033221', 'pranavlogistics.example.com'],
  ['Greenleaf Pharma', 'Hyderabad', 'Pharma', 'Permanent', 8.33, 'Net 30', 180, 'Dr. Lakshmi Narayan', '9848122456', 'greenleafpharma.example.com'],
  ['Finora Capital', 'Mumbai', 'BFSI', 'Both', 10, 'Net 30', 90, 'Arjun Malhotra', '9833088190', 'finoracapital.example.com'],
  ['Vertex Telecom Services', 'Noida', 'Telecom', 'Contract', 0, 'Net 30', 0, 'Pooja Saxena', '9871022334', 'vertextelecom.example.com'],
];

// Families of roles: how their candidates look.
const FAM = {
  java: { titles: ['Java Developer', 'Senior Java Developer', 'Backend Engineer', 'Software Engineer'], skills: ['Java', 'Spring Boot', 'Microservices', 'Kafka', 'MySQL', 'AWS', 'REST APIs', 'Hibernate'], base: 4.5, per: 1.45, companies: ['Infosys', 'TCS', 'Wipro', 'Cognizant', 'Persistent Systems', 'Tech Mahindra', 'LTIMindtree', 'Capgemini'] },
  react: { titles: ['Frontend Developer', 'React Developer', 'UI Engineer', 'Full Stack Developer'], skills: ['React', 'TypeScript', 'Redux', 'Next.js', 'Node.js', 'GraphQL', 'Tailwind', 'Jest'], base: 4.2, per: 1.5, companies: ['Zoho', 'Freshworks', 'Mphasis', 'HCLTech', 'Accenture', 'Publicis Sapient', 'Thoughtworks'] },
  qa: { titles: ['QA Engineer', 'Automation Test Engineer', 'SDET', 'QA Lead'], skills: ['Selenium', 'Java', 'API Testing', 'Postman', 'Cypress', 'JIRA', 'TestNG', 'Playwright'], base: 3.4, per: 1.1, companies: ['Infosys', 'Cognizant', 'Capgemini', 'Wipro', 'QualityKiosk', 'Mindtree'] },
  devops: { titles: ['DevOps Engineer', 'Cloud Engineer', 'Site Reliability Engineer'], skills: ['AWS', 'Kubernetes', 'Terraform', 'Jenkins', 'Docker', 'Linux', 'Python', 'Prometheus'], base: 5.5, per: 1.7, companies: ['Amazon', 'Accenture', 'Tech Mahindra', 'IBM India', 'Rackspace', 'Cloudcover'] },
  data: { titles: ['Data Analyst', 'Data Engineer', 'BI Developer', 'Analytics Manager'], skills: ['SQL', 'Python', 'Power BI', 'Tableau', 'Spark', 'Airflow', 'Snowflake', 'Excel'], base: 4.5, per: 1.5, companies: ['Mu Sigma', 'Fractal', 'Deloitte', 'EY GDS', 'Genpact', 'ZS Associates'] },
  sales: { titles: ['Business Development Manager', 'Key Account Manager', 'Sales Executive', 'Regional Sales Manager'], skills: ['B2B Sales', 'Lead Generation', 'Negotiation', 'CRM', 'Key Accounts', 'Channel Sales', 'Forecasting'], base: 3.2, per: 1.3, companies: ['Tata Communications', 'Bharti Airtel', 'Havells', 'Pidilite', 'Asian Paints', 'Godrej', 'Dabur'] },
  finance: { titles: ['Accounts Manager', 'FP&A Analyst', 'Financial Controller', 'Credit Analyst'], skills: ['Tally', 'GST', 'IFRS', 'Financial Modelling', 'MIS Reporting', 'SAP FICO', 'Audit', 'Excel'], base: 4, per: 1.25, companies: ['Deloitte', 'KPMG', 'Bajaj Finance', 'HDFC Bank', 'ICICI Securities', 'Axis Bank'] },
  hr: { titles: ['HR Business Partner', 'Talent Acquisition Specialist', 'HR Generalist'], skills: ['Talent Acquisition', 'Employee Relations', 'HRIS', 'Payroll', 'Onboarding', 'Compensation'], base: 3.5, per: 1.1, companies: ['Randstad', 'Quess', 'TeamLease', 'Adecco', 'ManpowerGroup'] },
  mech: { titles: ['Production Engineer', 'Quality Engineer', 'Maintenance Manager', 'Plant Engineer'], skills: ['Lean Manufacturing', 'Six Sigma', 'PLC', 'CNC', 'Quality Control', 'ISO 9001', 'SAP PP', 'Root Cause Analysis'], base: 3.6, per: 1.15, companies: ['Mahindra', 'Bosch', 'Ashok Leyland', 'TVS Motor', 'Bajaj Auto', 'Tata Motors', 'L&T'] },
  scm: { titles: ['Supply Chain Manager', 'Logistics Executive', 'Warehouse Manager', 'Procurement Specialist'], skills: ['Supply Chain', 'Warehouse Management', 'Procurement', 'SAP MM', 'Vendor Management', 'Inventory', 'Last-mile'], base: 3.4, per: 1.2, companies: ['Delhivery', 'Blue Dart', 'Amazon', 'Flipkart', 'DHL', 'Gati', 'Mahindra Logistics'] },
  pharma: { titles: ['QA Executive', 'QC Analyst', 'Regulatory Affairs Specialist', 'Production Chemist'], skills: ['GMP', 'HPLC', 'Regulatory Affairs', 'Validation', 'CAPA', 'USFDA', 'Documentation'], base: 3.5, per: 1.1, companies: ["Dr. Reddy's", 'Cipla', 'Sun Pharma', 'Lupin', 'Zydus', 'Aurobindo', 'Biocon'] },
  health: { titles: ['Hospital Operations Manager', 'Medical Coding Specialist', 'Healthcare Administrator', 'Patient Care Coordinator'], skills: ['Hospital Operations', 'NABH', 'Medical Coding', 'Billing', 'Patient Care', 'Insurance TPA', 'MIS'], base: 3.4, per: 1.0, companies: ['Apollo Hospitals', 'Fortis', 'Manipal', 'Narayana Health', 'Max Healthcare', 'Aster DM'] },
  telecom: { titles: ['RF Engineer', 'Network Engineer', 'Telecom Project Engineer', 'NOC Engineer'], skills: ['RF Planning', '4G/5G', 'OSS/BSS', 'Cisco', 'Network Security', 'Drive Test', 'MPLS'], base: 3.8, per: 1.2, companies: ['Ericsson', 'Nokia', 'Jio', 'Vodafone Idea', 'Huawei', 'Tejas Networks'] },
  civil: { titles: ['Site Engineer', 'Project Manager Civil', 'Billing Engineer', 'Planning Engineer'], skills: ['AutoCAD', 'Primavera', 'Quantity Surveying', 'Site Execution', 'Billing', 'Contracts', 'MS Project'], base: 3.4, per: 1.15, companies: ['L&T', 'Shapoorji Pallonji', 'NCC', 'Afcons', 'KEC International', 'GMR'] },
  retail: { titles: ['Category Manager', 'Merchandising Manager', 'Store Operations Manager', 'E-commerce Executive'], skills: ['Category Management', 'Merchandising', 'Marketplace', 'Pricing', 'Inventory', 'P&L', 'Vendor Negotiation'], base: 3.6, per: 1.3, companies: ['Reliance Retail', 'Flipkart', 'Myntra', 'Tata Trent', 'Shoppers Stop', 'BigBasket'] },
  cx: { titles: ['Customer Success Manager', 'Customer Support Lead', 'Operations Executive'], skills: ['Customer Success', 'Escalations', 'Zendesk', 'SLA', 'Retention', 'Onboarding', 'Voice Support'], base: 2.8, per: 0.9, companies: ['Teleperformance', 'Concentrix', 'Genpact', 'Paytm', 'Swiggy', 'Byju\'s'] },
};

// title, client#, kind, positions, family, expMin, expMax, ctcMin, ctcMax (lakh) or monthly rate (rupees), location, priority, status, opened days ago, recruiter#s, pulse
// pulse: 'live' = recent movement, 'cold' = no movement for a while
const JOBS = [
  ['Senior Java Developer', 0, 'Permanent', 3, 'java', 5, 9, 16, 24, 'Pune (Hybrid)', 'Hot', 'Open', 34, [0, 1], 'live'],
  ['React Frontend Lead', 0, 'Permanent', 1, 'react', 6, 10, 20, 30, 'Pune', 'Normal', 'Open', 27, [1], 'live'],
  ['QA Automation Engineer', 0, 'Permanent', 2, 'qa', 3, 6, 8, 14, 'Pune', 'Normal', 'Open', 41, [3], 'cold'],
  ['DevOps Engineer', 0, 'Permanent', 1, 'devops', 4, 8, 14, 22, 'Pune (Hybrid)', 'Normal', 'Filled', 78, [0], 'live'],
  ['Backend Engineer (Payments)', 1, 'Permanent', 2, 'java', 4, 8, 18, 28, 'Mumbai', 'Hot', 'Open', 22, [1, 2], 'live'],
  ['Data Engineer', 1, 'Permanent', 1, 'data', 4, 7, 16, 26, 'Mumbai (Hybrid)', 'Normal', 'Open', 30, [4], 'live'],
  ['Credit Risk Analyst', 1, 'Permanent', 1, 'finance', 3, 6, 9, 15, 'Mumbai', 'Normal', 'Filled', 64, [2], 'live'],
  ['Full Stack Developer', 1, 'Permanent', 1, 'react', 3, 6, 12, 20, 'Mumbai', 'Normal', 'Closed', 55, [1], 'live'],
  ['Hospital Operations Manager', 2, 'Permanent', 1, 'health', 8, 14, 14, 22, 'Bengaluru', 'Hot', 'Open', 19, [2], 'live'],
  ['Medical Coding Specialist', 2, 'Permanent', 3, 'health', 2, 5, 4, 7, 'Bengaluru', 'Normal', 'Open', 38, [2, 4], 'live'],
  ['Patient Care Coordinator', 2, 'Permanent', 2, 'health', 2, 5, 3.5, 6, 'Bengaluru', 'Normal', 'On hold', 45, [4], 'cold'],
  ['Production Engineer', 3, 'Permanent', 2, 'mech', 3, 7, 5, 9, 'Chennai', 'Normal', 'Open', 29, [3], 'live'],
  ['Quality Manager', 3, 'Permanent', 1, 'mech', 9, 14, 12, 18, 'Chennai', 'Normal', 'Filled', 72, [3], 'live'],
  ['Maintenance Manager', 3, 'Permanent', 1, 'mech', 8, 12, 10, 16, 'Chennai (Plant)', 'Normal', 'Open', 52, [3], 'cold'],
  ['Category Manager', 4, 'Permanent', 2, 'retail', 5, 9, 14, 22, 'Gurugram', 'Hot', 'Open', 16, [0, 4], 'live'],
  ['Customer Success Manager', 4, 'Permanent', 3, 'cx', 3, 6, 6, 10, 'Gurugram (Hybrid)', 'Normal', 'Open', 24, [4], 'live'],
  ['E-commerce Executive', 4, 'Permanent', 2, 'retail', 1, 3, 3, 5, 'Gurugram', 'Normal', 'Lost', 60, [0], 'live'],
  ['Site Engineer', 5, 'Permanent', 3, 'civil', 3, 7, 5, 9, 'Hyderabad (Site)', 'Normal', 'Open', 33, [3], 'live'],
  ['Project Planning Engineer', 5, 'Permanent', 1, 'civil', 6, 10, 9, 15, 'Hyderabad', 'Normal', 'Filled', 68, [3], 'live'],
  ['Billing Engineer (Contract)', 5, 'Contract', 2, 'civil', 4, 8, 78000, 78000, 'Hyderabad (Site)', 'Normal', 'Open', 21, [3], 'live'],
  ['Warehouse Manager', 6, 'Permanent', 1, 'scm', 6, 10, 8, 13, 'Ahmedabad', 'Normal', 'Open', 36, [0], 'live'],
  ['Supply Chain Analyst', 6, 'Permanent', 2, 'scm', 2, 5, 5, 8, 'Ahmedabad', 'Normal', 'On hold', 48, [0], 'cold'],
  ['QA Executive (Formulations)', 7, 'Permanent', 3, 'pharma', 2, 5, 3.5, 6, 'Hyderabad', 'Normal', 'Open', 26, [2], 'live'],
  ['Regulatory Affairs Specialist', 7, 'Permanent', 1, 'pharma', 5, 9, 9, 15, 'Hyderabad', 'Hot', 'Open', 14, [2, 0], 'live'],
  ['FP&A Manager', 8, 'Permanent', 1, 'finance', 7, 11, 18, 28, 'Mumbai', 'Normal', 'Closed', 58, [1], 'live'],
  ['Java Developer (Contract)', 8, 'Contract', 3, 'java', 4, 8, 118000, 118000, 'Mumbai (Hybrid)', 'Hot', 'Open', 12, [1, 3], 'live'],
  ['Network Engineer (Contract)', 9, 'Contract', 4, 'telecom', 3, 7, 72000, 72000, 'Noida', 'Normal', 'Open', 18, [3], 'live'],
  ['RF Engineer (Contract)', 9, 'Contract', 1, 'telecom', 4, 8, 82000, 82000, 'Noida', 'Normal', 'Filled', 70, [3], 'live'],
];

// Candidate names
const FIRST = ['Aarav', 'Vihaan', 'Arjun', 'Rohan', 'Karan', 'Siddharth', 'Rahul', 'Amit', 'Nikhil', 'Pranav', 'Aditya', 'Varun', 'Manish', 'Deepak', 'Suresh', 'Ramesh', 'Vikram', 'Harsh', 'Gaurav', 'Tushar',
  'Ananya', 'Priya', 'Neha', 'Pooja', 'Sneha', 'Kavya', 'Divya', 'Isha', 'Shruti', 'Meera', 'Riya', 'Swati', 'Nisha', 'Anjali', 'Komal', 'Sakshi', 'Tanvi', 'Pallavi', 'Radhika', 'Aishwarya',
  'Mohammed', 'Imran', 'Faisal', 'Zoya', 'Farhan', 'Sana', 'Gurpreet', 'Harpreet', 'Jaspreet', 'Simran', 'Arun', 'Karthik', 'Lakshmi', 'Ramya', 'Vignesh', 'Suresh', 'Bhavna', 'Chirag', 'Hardik', 'Jigar'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Patel', 'Shah', 'Mehta', 'Joshi', 'Kulkarni', 'Deshmukh', 'Patil', 'Jadhav', 'Iyer', 'Nair', 'Menon', 'Reddy', 'Naidu', 'Rao', 'Pillai', 'Krishnan',
  'Khan', 'Shaikh', 'Ansari', 'Qureshi', 'Banerjee', 'Chatterjee', 'Das', 'Bose', 'Kapoor', 'Malhotra', 'Chopra', 'Bhatia', 'Agarwal', 'Jain', 'Mishra', 'Pandey', 'Tiwari', 'Yadav', 'Thakur', 'Saxena'];
const CITIES = ['Pune', 'Mumbai', 'Bengaluru', 'Hyderabad', 'Chennai', 'Gurugram', 'Noida', 'Ahmedabad', 'Delhi', 'Nagpur', 'Indore', 'Kolkata', 'Jaipur', 'Coimbatore', 'Nashik', 'Vadodara'];
const SRC_W = ['Naukri', 'Naukri', 'Naukri', 'Naukri', 'LinkedIn', 'LinkedIn', 'LinkedIn', 'Referral', 'Referral', 'Walk-in', 'Database', 'Database'];
const NOTICE_W = ['Immediate', '15 days', '30 days', '30 days', '30 days', '45 days', '60 days', '60 days', '90 days'];

// feedback lines
const FB_GOOD = ['Strong on fundamentals and communicates clearly. Recommend moving ahead.', 'Good hands-on experience, answered the design round well.', 'Confident, clear examples from past projects. Culture fit looks good.', 'Technically sound; needs a little more depth on system design but fine for this level.', 'Very good problem solving. Panel is positive.'];
const FB_BAD = ['Concepts are weak for the experience claimed.', 'Communication needs work; could not explain past projects.', 'Good profile but expectation is much above the band.', 'Did not meet the technical bar in the coding round.', 'Looking mainly for a hike; low interest in the role.'];

// -------------------------------- helpers ---------------------------------
function jdText(job, family, client) {
  const f = FAM[family];
  return `${client} is hiring a ${job[0]} (${job[3]} position${job[3] > 1 ? 's' : ''}) for ${job[9]}.\n\nWhat you will do\n- Own the day-to-day work of the role and deliver to the agreed timelines\n- Work with the ${client} team and report to the reporting manager\n- Keep documentation and reports up to date\n\nWhat we look for\n- ${job[5]} to ${job[6]} years of relevant experience\n- Hands-on with ${f.skills.slice(0, 4).join(', ')}\n- Good communication and a stable career record\n\nOffer\n${job[2] === 'Contract' ? `Contract engagement, billing around Rs ${Number(job[7]).toLocaleString('en-IN')} per month.` : `CTC range Rs ${job[7]} to ${job[8]} lakh per year, depending on experience.`}`;
}
function resumeText(c) {
  return `${c.name}\n${c.designation} | ${c.city}\nMobile: ${c.mobile}   Email: ${c.email}\n\nSUMMARY\n${c.designation} with ${c.total_exp} years of experience, currently at ${c.current_company}. Notice period: ${c.notice_period}.\n\nSKILLS\n${c.skills}\n\nEXPERIENCE\n${c.current_company} — ${c.designation} (${c.total_exp > 3 ? `${Math.floor(c.total_exp / 2)}+ years` : 'current'})\n- Delivered features and reports end to end with the team\n- Worked closely with business users to fix issues quickly\n\nEDUCATION\nB.E. / B.Tech / B.Com / MBA (as per profile)\n\nCurrent CTC: Rs ${c.current_ctc} lakh   Expected CTC: Rs ${c.expected_ctc} lakh\n\n(Demo resume created by the Placement desk demo data.)\n`;
}

function ensureRecruiters(adminUser) {
  const ids = [];
  const bcrypt = require('bcryptjs');
  // A role for recruiters, so the Roles page and "Can see" can be shown.
  let role = db.prepare("SELECT id FROM roles WHERE name = 'Placement Officer'").get();
  if (!role) role = { id: db.prepare("INSERT INTO roles (name, is_system) VALUES ('Placement Officer', 0)").run().lastInsertRowid };
  const hasPerm = db.prepare("SELECT id FROM role_permissions WHERE role_id = ? AND module = 'placement'").get(role.id);
  if (!hasPerm) db.prepare("INSERT INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_export) VALUES (?, 'placement', 1, 1, 1, 0, 1)").run(role.id);
  for (const name of RECRUITERS) {
    const username = `pl.demo.${name.split(' ')[0].toLowerCase()}`;
    let u = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!u) {
      // a password nobody knows: these people are for the demo, not for signing in
      const hash = bcrypt.hashSync(`x${R()}${Date.now()}`, 8);
      u = { id: db.prepare('INSERT INTO users (username, password_hash, full_name, role_id, active) VALUES (?,?,?,?,1)').run(username, hash, name, role.id).lastInsertRowid };
    }
    ids.push(u.id);
  }
  return ids;
}


// ------------------------------- the people who are already deployed ------
// client#, name, role, bill (per month), pay (per month), started days ago, ends in days
const DEPLOYED = [
  [9, 'Sandeep Chauhan', 'Network Engineer', 72000, 57000, 210, 95],
  [9, 'Mohit Rawat', 'Network Engineer', 72000, 56000, 150, 40],
  [9, 'Aman Tyagi', 'NOC Engineer', 64000, 50000, 120, 24],
  [8, 'Harish Menon', 'Java Developer', 118000, 94000, 180, 70],
  [8, 'Sheetal Pawar', 'Java Developer', 118000, 92000, 95, 85],
  [8, 'Kunal Bhatt', 'QA Engineer', 78000, 60000, 200, 12],
  [8, 'Tarun Bajaj', 'SAP Consultant', 130000, 104000, 260, 64],
  [5, 'Naveen Chandra', 'Planning Engineer', 88000, 70000, 240, 110],
  [0, 'Divya Raghavan', 'Automation Tester', 76000, 58000, 140, 50],
  [4, 'Yash Oberoi', 'Data Analyst', 68000, 52000, 110, 18],
];

const PATH = ['Sourced', 'Screened', 'Submitted', 'Interview L1', 'Interview L2', 'Final round', 'Offered', 'Offer accepted', 'Joined'];
const ROUND_OF = { 'Interview L1': 'L1', 'Interview L2': 'L2', 'Final round': 'Final' };
const REMARK = {
  Sourced: 'Added to the opening', Screened: 'Phone screening done, profile fits', Submitted: 'Profile sent to the client', 'Interview L1': 'First round fixed',
  'Interview L2': 'Moved to the second round', 'Final round': 'Moved to the final round', Offered: 'Offer released', 'Offer accepted': 'Candidate accepted the offer', Joined: 'Joined the client',
};

function finishInvoice(id, { date, status, due, paidOn }) {
  const d = db.prepare('SELECT grand_total FROM sales_documents WHERE id = ?').get(id);
  const paid = status === 'Paid';
  db.prepare(`UPDATE sales_documents SET doc_date = ?, due_date = ?, status = ?, payment_status = ?, amount_paid = ?, balance_due = ?, sent_at = ?, paid_at = ?,
      notes = COALESCE(notes, '') || ' [${TAG}]' WHERE id = ?`)
    .run(`${date}T09:30:00.000Z`, due, status, paid ? 'Paid' : 'Unpaid', paid ? d.grand_total : 0, paid ? 0 : d.grand_total, `${date}T09:35:00.000Z`, paid ? `${paidOn || date}T12:00:00.000Z` : null, id);
}

// ------------------------------- load ---------------------------------------
function load(adminUser) {
  if (Number(db.prepare('SELECT COUNT(*) c FROM pl_candidates WHERE is_demo = 1').get().c) > 0) throw bad('Demo data is already loaded. Remove it first to load it again.', 409);
  const docs = require('../documentService');
  const contractSvc = require('./contract');

  return db.transaction(() => {
    const out = { clients: 0, jobs: 0, candidates: 0, pipeline: 0, interviews: 0, offers: 0, joined: 0, invoices: 0, deployed: 0, contacts: 0 };
    const rec = ensureRecruiters();
    const recOf = (i) => rec[((i % rec.length) + rec.length) % rec.length];

    // ---- clients
    const clientIds = CLIENTS.map((c, i) => {
      const [name, city, industry, agreement, fee, terms, guarantee, spoc, phone, domain] = c;
      let a = db.prepare('SELECT id FROM accounts WHERE account_name = ?').get(name);
      if (!a) {
        const id = db.prepare(`INSERT INTO accounts (account_name, account_type, industry, city, country, phone, email, status, owner_id, tags, customer_since)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(name, 'Customer', industry, city, 'India', phone, `hr@${domain}`, 'Active', recOf(i), TAG, dayAgo(between(120, 700))).lastInsertRowid;
        a = { id };
      }
      const spocMail = `${spoc.replace('Dr. ', '').toLowerCase().split(' ').slice(0, 2).join('.')}@${domain}`;
      db.prepare(`INSERT INTO pl_client_terms (account_id, agreement_type, fee_percent, payment_terms, guarantee_days, spoc_name, spoc_phone, spoc_email, notes)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(a.id, agreement, fee || null, terms, guarantee || null, spoc, phone, spocMail,
        agreement === 'Contract' ? 'Monthly invoice on approved timesheets.' : 'Fee on joining. Replacement if the person leaves within the guarantee period.');
      const [first, ...rest] = spoc.replace('Dr. ', '').split(' ');
      db.prepare(`INSERT INTO contacts (first_name, last_name, job_title, account_id, email, phone, mobile, contact_type, contact_status, owner_id, tags, city)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(first, rest.join(' '), 'Head - Talent / HR', a.id, spocMail, phone, phone, 'Primary', 'Active', recOf(i), TAG, city);
      out.clients += 1;
      return a.id;
    });

    // ---- candidates: plain objects first, written once their openings are known
    const usedFam = ['java', 'react', 'qa', 'devops', 'data', 'finance', 'mech', 'scm', 'pharma', 'health', 'telecom', 'civil', 'retail', 'cx'];
    const weight = { java: 18, react: 12, qa: 11, devops: 8, data: 10, finance: 12, mech: 13, scm: 11, pharma: 12, health: 13, telecom: 12, civil: 11, retail: 10, cx: 9 };
    const plan = [];
    for (const k of usedFam) plan.push(...Array(weight[k]).fill(k));
    const famList = shuffle(plan).slice(0, 180);
    while (famList.length < 180) famList.push(pick(usedFam));
    const cands = [];
    const mobiles = new Set();
    let codeNo = 1040;
    for (let i = 0; i < famList.length; i += 1) {
      const fk = famList[i]; const f = FAM[fk];
      const first = pick(FIRST); const last = pick(LAST);
      let mobile; do { mobile = `${pick(['98', '97', '99', '96', '90', '88', '70', '77'])}${String(between(10000000, 99999999))}`; } while (mobiles.has(mobile));
      mobiles.add(mobile);
      const exp = r1(Math.max(1, Math.min(14, 1 + R() * R() * 13 + R() * 3)));
      const cur = r1(Math.max(2.4, f.base + exp * f.per * (0.8 + R() * 0.4)));
      codeNo += 1;
      cands.push({
        i, fk, code: `CAN-${codeNo}`, name: `${first} ${last}`, mobile: `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${between(1, 99)}@example.com`, city: chance(0.55) ? pick(CITIES.slice(0, 6)) : pick(CITIES),
        current_company: pick(f.companies), designation: pick(f.titles), total_exp: exp, relevant_exp: r1(Math.max(0.5, exp - R() * 2)),
        current_ctc: cur, expected_ctc: r1(cur * (1.15 + R() * 0.25)), notice: pick(NOTICE_W), skills: shuffle(f.skills).slice(0, between(3, 5)).join(', '),
        source: pick(SRC_W), pipes: [], status: 'New', reserved: false,
      });
    }
    // some people only sit in the database, never put on an opening yet
    shuffle(cands).slice(0, 26).forEach((c) => { c.reserved = true; });

    // ---- openings
    const joinPlan = [[0, 3], [4, 9], [14, 6], [3, 24], [6, 31], [12, 38], [18, 47], [27, 58], [19, 5]];
    const joinAgoOf = new Map();
    for (const [ji, ago] of joinPlan) joinAgoOf.set(ji, Math.min(joinAgoOf.get(ji) || 999, ago));
    const jobs = JOBS.map((j, idx) => {
      const [title, ci, kind, positions, fam, expMin, expMax, ctcMin, ctcMax, loc, priority, status, opened, recs, pulse] = j;
      const terms = CLIENTS[ci];
      const closedDays = status === 'Filled' ? joinAgoOf.get(idx) : (status === 'Closed' || status === 'Lost') ? Math.max(3, opened - between(18, 38)) : null;
      const id = db.prepare(`INSERT INTO pl_jobs (code, title, account_id, hiring_type, positions, skills, exp_min, exp_max, ctc_min, ctc_max, bill_rate, location, priority, status,
          fee_percent, target_date, opened_on, closed_on, jd_text, owner_id, is_demo, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`)
        .run(`JOB-${S.today().slice(0, 4)}-${String(idx + 11).padStart(4, '0')}`, title, clientIds[ci], kind, positions, FAM[fam].skills.slice(0, 5).join(', '), expMin, expMax,
          kind === 'Permanent' ? ctcMin : null, kind === 'Permanent' ? ctcMax : null, kind === 'Contract' ? ctcMin : null, loc, priority, status,
          kind === 'Permanent' ? (terms[4] || 8.33) : null, dayAgo(opened - 35), dayAgo(opened), closedDays !== null ? dayAgo(closedDays) : null,
          jdText(j, fam, terms[0]), recOf(recs[0]), adminUser.id).lastInsertRowid;
      for (const r of recs) db.prepare('INSERT INTO pl_job_recruiters (job_id, user_id) VALUES (?,?)').run(id, recOf(r));
      out.jobs += 1;
      return { id, idx, ci, title, kind, positions, fam, status, opened, closedDays, pulse, recs, priority, clientId: clientIds[ci], terms, ctcMin, ctcMax };
    });

    // ---- who is on which opening, and how far they got
    const pipes = [];
    const takenOn = (job) => new Set(pipes.filter((p) => p.job === job).map((p) => p.cand.i));
    const addPipe = (job, cand, target, endDays, extra = {}) => {
      if (!cand) return null;
      const p = { job, cand, target, endDays, ...extra };
      pipes.push(p); cand.pipes.push(p);
      return p;
    };
    // `live`: a person we are working with now (once only); otherwise someone who dropped out (may have several)
    const free = (job, live) => {
      const taken = takenOn(job);
      let list = cands.filter((c) => c.fk === job.fam && !c.reserved && !taken.has(c.i) && c.status !== 'Placed');
      if (live) list = list.filter((c) => !c.pipes.some((p) => !['Rejected'].includes(p.target)));
      return shuffle(list).sort((a, b) => a.pipes.length - b.pipes.length)[0] || null;
    };

    const joinedPipes = [];
    for (const [ji, ago] of joinPlan) {
      const job = jobs[ji]; const c = free(job, true);
      c.status = 'Placed';
      joinedPipes.push(addPipe(job, c, 'Joined', ago));
    }
    for (const [ji, st, ago] of [[5, 'Offered', 4], [8, 'Offered', 2], [1, 'Offer accepted', 6], [15, 'Offer accepted', 3]]) {
      const job = jobs[ji]; addPipe(job, free(job, true), st, ago);
    }
    addPipe(jobs[9], free(jobs[9], false), 'Rejected', 14, { declinedOffer: 'CTC mismatch', rejectAt: 'Offered' });

    const openJobs = jobs.filter((j) => j.status === 'Open');
    const liveJobs = openJobs.filter((j) => j.pulse === 'live');
    const hotLive = liveJobs.slice().sort((a, b) => (b.priority === 'Hot') - (a.priority === 'Hot'));
    const advancedSlots = [];
    for (const [st, n] of [['Final round', 5], ['Interview L2', 8], ['Interview L1', 14], ['Submitted', 22]]) for (let k = 0; k < n; k += 1) advancedSlots.push(st);
    advancedSlots.forEach((st, k) => {
      // the hot openings get most of the advanced candidates
      const job = hotLive[k % (st === 'Final round' ? 6 : hotLive.length)];
      addPipe(job, free(job, true) || free(hotLive[(k + 3) % hotLive.length], true), st, between(0, 8));
    });
    const earlySlots = [];
    for (const [st, n] of [['Screened', 30], ['Sourced', 35]]) for (let k = 0; k < n; k += 1) earlySlots.push(st);
    earlySlots.forEach((st, k) => {
      const job = openJobs[k % openJobs.length];
      addPipe(job, free(job, true), st, job.pulse === 'cold' ? between(12, 22) : between(0, 9));
    });
    for (const job of jobs.filter((j) => j.status === 'On hold')) {
      for (let k = 0; k < 4; k += 1) addPipe(job, free(job, true), 'On hold', between(10, 26), { prevStage: pick(['Submitted', 'Interview L1', 'Screened']) });
    }
    // everyone else dropped out somewhere along the way
    const dropAt = ['Sourced', 'Sourced', 'Sourced', 'Sourced', 'Screened', 'Screened', 'Screened', 'Screened', 'Screened', 'Screened', 'Submitted', 'Submitted', 'Submitted', 'Submitted', 'Submitted', 'Submitted', 'Submitted', 'Submitted', 'Interview L1'];
    const REASON_BY = {
      Sourced: ['Candidate not interested', 'Candidate not interested', 'CTC mismatch', 'Did not turn up'],
      Screened: ['Candidate not interested', 'CTC mismatch', 'CTC mismatch', 'Client rejected'],
      Submitted: ['Client rejected', 'Client rejected', 'Client rejected', 'CTC mismatch', 'Candidate not interested'],
      'Interview L1': ['Client rejected', 'Client rejected', 'Candidate not interested', 'Did not turn up', 'CTC mismatch'],
      'Interview L2': ['Client rejected', 'Counter offer', 'CTC mismatch'],
      'Final round': ['Client rejected', 'Counter offer', 'Backed out', 'CTC mismatch'],
    };
    for (let tries = 0; pipes.length < 322 && tries < 9000; tries += 1) {
      const job = jobs[tries % jobs.length];
      const c = free(job, false);
      if (!c) continue;
      const at = pick(dropAt);
      const jobAge = job.closedDays !== null ? job.opened - job.closedDays : job.opened;
      const lo = job.pulse === 'cold' ? 14 : (chance(0.75) ? 9 : 2);
      const end = job.closedDays !== null ? between(job.closedDays, job.closedDays + Math.max(1, Math.min(jobAge, 20))) : between(Math.min(lo, Math.max(2, job.opened - 2)), Math.max(lo + 1, Math.min(job.opened - 1, 50)));
      addPipe(job, c, 'Rejected', end, { rejectAt: at, reason: pick(REASON_BY[at]) });
    }

    // ---- write the candidates
    const firstDay = (c) => (c.pipes.length ? Math.max(...c.pipes.map((p) => Math.min(p.job.opened, p.endDays + 25))) : between(2, 30));
    for (const c of cands) {
      const live = c.pipes.some((p) => !['Rejected', 'Joined'].includes(p.target));
      if (c.status !== 'Placed') c.status = live ? 'Active' : (c.pipes.length ? 'Screened' : 'New');
    }
    // a few who must not be called again, and two who are blacklisted (only people who are not on a live opening)
    const quiet = shuffle(cands.filter((c) => c.status === 'Screened' || c.status === 'New'));
    quiet.slice(0, 6).forEach((c) => { c.status = 'Do not call'; });
    quiet.slice(6, 8).forEach((c) => { c.status = 'Blacklisted'; c.blacklist = true; });
    for (const c of cands) {
      const days = firstDay(c) + between(0, 3);
      const ownerJob = c.pipes[0] ? c.pipes[0].job : null;
      c.ownerId = ownerJob ? recOf(ownerJob.recs[c.i % ownerJob.recs.length]) : recOf(c.i);
      c.createdDays = days;
      let resume = null;
      if (chance(0.78)) {
        const text = resumeText({ ...c, notice_period: c.notice });
        resume = db.prepare('INSERT INTO pl_files (kind, file_name, mime, size, data_b64, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
          .run('resume', `${c.name} - Resume.txt`, 'text/plain', Buffer.byteLength(text), Buffer.from(text).toString('base64'), c.ownerId, stamp(days, 10, 0)).lastInsertRowid;
      }
      c.dbId = db.prepare(`INSERT INTO pl_candidates (code, name, mobile, mobile_key, email, email_key, city, current_company, designation, total_exp, relevant_exp, current_ctc, expected_ctc,
          notice_period, skills, source, status, owner_id, resume_file_id, notes, is_demo, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`)
        .run(c.code, c.name, c.mobile, S.mobileKey(c.mobile), c.email, S.emailKey(c.email), c.city, c.current_company, c.designation, c.total_exp, c.relevant_exp, c.current_ctc, c.expected_ctc,
          c.notice, c.skills, c.source, c.status, c.ownerId, resume, c.blacklist ? 'Did not turn up for two interviews and stopped taking calls.' : null, c.ownerId, stamp(days, 10, 0), stamp(days, 10, 0)).lastInsertRowid;
      out.candidates += 1;
    }

    // ---- write the pipelines with their history, interviews and offers
    const ivPlan = { today: 4, tomorrow: 3, week: 5, awaiting: 3 };
    const hasMeetings = [];
    for (const p of pipes) {
      const { job, cand } = p;
      const reachedStage = p.target === 'Rejected' ? p.rejectAt : p.target === 'On hold' ? p.prevStage : p.target;
      const upto = PATH.indexOf(reachedStage);
      const steps = PATH.slice(0, Math.max(0, upto) + 1);
      const lastDay = p.target === 'Rejected' ? p.endDays + between(0, 2) : p.endDays;
      const cap = Math.max(job.opened, lastDay);
      const gap = steps.length > 1 ? Math.max(1, Math.min(p.target === 'Joined' ? 6 : (p.target === 'Rejected' ? 5 : 3), Math.floor((cap - lastDay) / (steps.length - 1)))) : 0;
      const days = steps.map((_, k) => Math.min(cap, lastDay + (steps.length - 1 - k) * gap));
      p.steps = steps; p.days = days;
      const ownerId = recOf(job.recs[cand.i % job.recs.length]);
      p.ownerId = ownerId;
      const [h, m] = workTime();
      const changedAt = stamp(p.endDays, h, m);
      p.id = db.prepare(`INSERT INTO pl_pipeline (job_id, candidate_id, stage, prev_stage, reject_reason, stage_changed_at, owner_id, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(job.id, cand.dbId, p.target, p.target === 'Rejected' ? reachedStage : (p.target === 'On hold' ? p.prevStage : null), p.target === 'Rejected' ? (p.declinedOffer || p.reason) : null,
          changedAt, ownerId, ownerId, stamp(days[0], 10, 0), changedAt).lastInsertRowid;
      const log = db.prepare('INSERT INTO pl_stage_log (pipeline_id, from_stage, to_stage, remark, reason, by_user, at) VALUES (?,?,?,?,?,?,?)');
      steps.forEach((st, k) => { const [hh, mm] = workTime(); log.run(p.id, k ? steps[k - 1] : null, st, REMARK[st], null, ownerId, stamp(days[k], hh, mm)); });
      if (p.target === 'Rejected') {
        log.run(p.id, reachedStage, 'Rejected', p.declinedOffer ? `Offer declined: ${p.declinedOffer}` : null, p.declinedOffer || p.reason, ownerId, stamp(p.endDays, ...workTime()));
      } else if (p.target === 'On hold') {
        log.run(p.id, reachedStage, 'On hold', 'The client paused this opening', null, ownerId, stamp(p.endDays, ...workTime()));
      }
      out.pipeline += 1;
    }

    // interviews
    const ivIns = db.prepare(`INSERT INTO pl_interviews (pipeline_id, round, scheduled_at, duration_min, mode, panel, link_or_place, result, feedback, meeting_id, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const PANELS = ['Hiring manager and tech lead', 'Engineering manager', 'Head of department', 'HR and hiring manager', 'Two senior engineers', 'Director and HR'];
    const slots = [];
    for (const [k, n] of Object.entries(ivPlan)) for (let x = 0; x < n; x += 1) slots.push(k);
    let slotNo = 0;
    for (const p of pipes) {
      const ivSteps = p.steps.map((st, k) => k).filter((k) => ROUND_OF[p.steps[k]]);
      const keep = ivSteps.slice(-1);
      p.steps.forEach((st, k) => {
        const round = ROUND_OF[st];
        if (!round || !keep.includes(k)) return;
        const isLast = k === ivSteps[ivSteps.length - 1] && k === p.steps.length - 1;
        const mode = pick(['Video', 'Video', 'Video', 'In person', 'Phone']);
        const place = mode === 'In person' ? `${CLIENTS[p.job.ci][1]} office` : mode === 'Video' ? 'Video link shared with the candidate' : 'Panel will call the candidate';
        let when; let result; let feedback = null; let meetingId = null;
        const [hh, mm] = workTime();
        if (isLast && !['Rejected', 'Joined', 'Offered', 'Offer accepted'].includes(p.target) && p.target !== 'On hold') {
          // an interview still to happen (or waiting for feedback)
          const kind = slots[slotNo] || 'later'; slotNo += 1;
          if (kind === 'today') { when = `${S.today()} ${String(between(15, 18)).padStart(2, '0')}:${pick(['00', '30'])}`; }
          else if (kind === 'tomorrow') { when = `${S.today(1)} ${String(between(10, 17)).padStart(2, '0')}:${pick(['00', '30'])}`; }
          else if (kind === 'week') { when = `${S.today(between(2, 6))} ${String(between(10, 17)).padStart(2, '0')}:${pick(['00', '30'])}`; }
          else if (kind === 'awaiting') { when = `${S.today(-between(1, 2))} ${String(between(10, 16)).padStart(2, '0')}:00`; }
          else { when = `${S.today(between(3, 9))} ${String(between(10, 17)).padStart(2, '0')}:${pick(['00', '30'])}`; }
          result = 'Scheduled';
          if (when.slice(0, 10) >= S.today()) {
            const title = `Interview ${round}: ${p.cand.name} for ${p.job.title}`;
            const isoStart = when.replace(' ', 'T');
            const end = new Date(`${isoStart}:00Z`); end.setUTCMinutes(end.getUTCMinutes() + 45);
            meetingId = db.prepare(`INSERT INTO meetings (meeting_title, related_module, related_record_id, meeting_type, location, video_link, start_datetime, end_datetime, organizer_id, assigned_user_id,
                status, agenda, time_zone, all_day, reminder_minutes, attendees_json, created_by, source)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(title, 'accounts', p.job.clientId, mode === 'In person' ? 'In-Person' : mode === 'Phone' ? 'Phone Call' : 'Video Call', mode === 'In person' ? place : null, null, isoStart, end.toISOString().slice(0, 16),
                p.ownerId, p.ownerId, 'Scheduled', `Candidate: ${p.cand.name}\nOpening: ${p.job.title}`, S.TZ, 0, 30, '[]', adminUser.id, 'crm').lastInsertRowid;
          }
        } else {
          const day = isLast && p.target === 'Rejected' ? p.endDays + 1 : p.days[k] - 0;
          when = `${dayAgo(Math.max(0, day))} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
          const rejectedHere = isLast && p.target === 'Rejected' && !p.declinedOffer;
          result = rejectedHere ? 'Rejected' : 'Cleared';
          feedback = rejectedHere ? pick(FB_BAD) : pick(FB_GOOD);
          if (isLast && p.target === 'Rejected' && p.reason === 'Did not turn up') { result = 'No show'; feedback = 'Candidate did not join the interview and was not reachable.'; }
        }
        ivIns.run(p.id, round, when, 45, mode, pick(PANELS), place, result, feedback, meetingId, p.ownerId, stamp(p.days[k], 10, 0), stamp(p.days[k], 10, 0));
        out.interviews += 1;
      });
    }

    // offers
    const offerIns = db.prepare(`INSERT INTO pl_offers (pipeline_id, offered_ctc, offer_date, expected_joining, actual_joining, status, decline_reason, fee_percent, fee_amount, guarantee_days, guarantee_end,
        created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const offerByPipe = new Map();
    for (const p of pipes) {
      if (!['Offered', 'Offer accepted', 'Joined'].includes(p.target) && !p.declinedOffer) continue;
      const terms = p.job.terms;
      const contractJob = p.job.kind === 'Contract';
      let ctc = contractJob ? r1((p.job.ctcMin * 0.8 * 12) / 100000) : r1(Math.min(p.job.ctcMax, Math.max(p.job.ctcMin, p.cand.expected_ctc * (0.93 + R() * 0.1))));
      const pct = contractJob ? null : (terms[4] || 8.33);
      const fee = contractJob ? 0 : Math.round(ctc * 100000 * (pct / 100));
      const offeredAt = p.days[PATH.indexOf('Offered')] ?? p.endDays;
      const status = p.declinedOffer ? 'Declined' : p.target === 'Joined' ? 'Joined' : p.target === 'Offer accepted' ? 'Accepted' : 'Offered';
      const joinOn = p.target === 'Joined' ? dayAgo(p.endDays) : null;
      const expected = joinOn || S.today(between(10, 35));
      const g = Number(terms[6]) || 0;
      const id = offerIns.run(p.id, ctc, dayAgo(offeredAt), expected, joinOn, status, p.declinedOffer || null, pct, fee, g || null, joinOn && g ? S.addDays(joinOn, g) : null,
        p.ownerId, stamp(offeredAt, 11, 0), stamp(p.endDays, 11, 0)).lastInsertRowid;
      offerByPipe.set(p.id, { id, fee, ctc, contractJob });
      out.offers += 1;
      if (status === 'Joined') out.joined += 1;
    }

    // ---- calls and messages to candidates, with the follow-ups
    const conIns = db.prepare('INSERT INTO pl_contacts (candidate_id, channel, outcome, remark, next_follow_up, follow_up_done, by_user, at) VALUES (?,?,?,?,?,?,?,?)');
    const OUT_TEXT = {
      Interested: ['Interested, profile shared for the opening.', 'Keen on the role. Will send the updated resume today.', 'Fine with the location and the CTC band.'],
      'Call back': ['Busy at work, asked to call after 7 pm.', 'In a meeting. Will talk tomorrow.', 'Wants to discuss with family and confirm.'],
      'Not reachable': ['Phone not picked up. Will try again.', 'Rang twice, no answer.'],
      'Not interested': ['Happy in the current job for now.', 'Not looking for a change right now.'],
      'Switched off': ['Phone switched off.'],
    };
    let dueNo = 0;
    const dueDays = [-3, -1, 0, 0, 0, 0, 1, 1, 1, 2, 3, 5, 6]; // overdue, today, tomorrow, this week
    for (const c of cands) {
      const n = c.pipes.length ? between(1, 3) : (chance(0.5) ? 1 : 0);
      for (let k = 0; k < n; k += 1) {
        const outcome = pick(['Interested', 'Interested', 'Interested', 'Call back', 'Call back', 'Not reachable', 'Not interested', 'Switched off']);
        const ago = Math.max(0, (c.createdDays || 10) - between(0, Math.max(1, (c.createdDays || 10) - 1)) - k);
        const [hh, mm] = workTime();
        let next = null; let done = 1;
        const last = k === n - 1;
        if (last && (c.status === 'Active' || c.status === 'Screened' || c.status === 'New') && ['Call back', 'Interested', 'Not reachable'].includes(outcome) && dueNo < dueDays.length && chance(0.55)) {
          next = `${S.today(dueDays[dueNo])} ${String(between(10, 18)).padStart(2, '0')}:${pick(['00', '30'])}`; dueNo += 1; done = 0;
        } else if (outcome === 'Call back') {
          next = dayAgo(Math.max(0, ago - 1));
        }
        conIns.run(c.dbId, pick(['Call', 'Call', 'Call', 'WhatsApp']), outcome, pick(OUT_TEXT[outcome]), next, done, c.ownerId, stamp(ago, hh, mm));
        out.contacts += 1;
        if (k === 0) c.lastContact = ago;
      }
      if (c.lastContact !== undefined) db.prepare('UPDATE pl_candidates SET last_contacted = ? WHERE id = ?').run(dayAgo(c.lastContact), c.dbId);
    }

    // ---- contract staffing: people already placed, and the two who joined from the openings
    const depIns = db.prepare(`INSERT INTO pl_deployed (account_id, job_id, candidate_id, person_name, role_title, bill_rate, pay_rate, start_date, end_date, status, owner_id, is_demo, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`);
    const deployed = [];
    DEPLOYED.forEach(([ci, name, role, bill, pay, startAgo, endIn], k) => {
      const id = depIns.run(clientIds[ci], null, null, name, role, bill, pay, dayAgo(startAgo), S.today(endIn), 'Active', recOf(k), null).lastInsertRowid;
      deployed.push({ id, startAgo, bill, pay, clientId: clientIds[ci], ci });
    });
    for (const p of joinedPipes) {
      if (p.job.kind !== 'Contract') continue;
      const bill = Number(p.job.ctcMin); const pay = Math.round(bill * 0.8);
      const id = depIns.run(p.job.clientId, p.job.id, p.cand.dbId, p.cand.name, p.job.title.replace(' (Contract)', ''), bill, pay, dayAgo(p.endDays), S.today(180 - p.endDays), 'Active', p.ownerId, null).lastInsertRowid;
      deployed.push({ id, startAgo: p.endDays, bill, pay, clientId: p.job.clientId, ci: p.job.ci });
    }
    out.deployed = deployed.length;

    // timesheets for the last two months
    const monthShift = (n) => { const d = new Date(`${S.today().slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };
    const mA = monthShift(2); const mB = monthShift(1);
    const dim = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
    for (const [m, state] of [[mA, 'approved'], [mB, 'mixed']]) {
      for (const d of deployed) {
        const startDate = dayAgo(d.startAgo);
        if (startDate > `${m}-${String(dim(m)).padStart(2, '0')}`) continue;
        let days = 26;
        if (startDate.slice(0, 7) === m) days = Math.max(1, Math.round((26 * (dim(m) - Number(startDate.slice(8)) + 1)) / dim(m)));
        else if (chance(0.35)) days = 26 - pick([0.5, 1, 2, 3]);
        const billable = Math.round((d.bill / 26) * days); const payout = Math.round((d.pay / 26) * days);
        const approved = state === 'approved' || d.ci === 9 || d.ci === 8;
        db.prepare(`INSERT INTO pl_timesheets (deployed_id, month, working_days, approved_days, billable, payout, margin, status, approved_by) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(d.id, m, 26, days, billable, payout, billable - payout, approved ? 'Approved' : 'Draft', approved ? adminUser.id : null);
      }
    }

    // this month so far: a draft with the days worked up to today (no random numbers here)
    {
      const m = S.today().slice(0, 7); const worked = Math.max(1, Math.min(26, Math.round((26 * Number(S.today().slice(8, 10))) / dim(m))));
      for (const d of deployed) {
        if (dayAgo(d.startAgo) > S.today()) continue;
        const billable = Math.round((d.bill / 26) * worked); const payout = Math.round((d.pay / 26) * worked);
        db.prepare(`INSERT INTO pl_timesheets (deployed_id, month, working_days, approved_days, billable, payout, margin, status, approved_by) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(d.id, m, 26, worked, billable, payout, billable - payout, 'Draft', null);
      }
    }

    // ---- invoices: four placement fees and two months of contract billing
    const joinedPerm = joinedPipes.filter((p) => p.job.kind === 'Permanent').sort((a, b) => b.endDays - a.endDays);
    const invPlan = [[47, 'Paid', null], [38, 'Paid', null], [31, 'Sent', -3], [24, 'Sent', 6]];
    for (const [ago, status, dueIn] of invPlan) {
      const p = joinedPerm.find((x) => x.endDays === ago);
      if (!p) continue;
      const o = offerByPipe.get(p.id);
      const row = db.prepare('SELECT * FROM pl_offers WHERE id = ?').get(o.id);
      const terms = p.job.terms;
      const invId = docs.create('invoice', {
        account_id: p.job.clientId, payment_terms: terms[5],
        notes: `Placement fee: ${p.cand.name}, ${p.job.title}. Joined on ${row.actual_joining}.`,
        items: [{ description: `Placement fee: ${p.cand.name} as ${p.job.title} · CTC Rs ${row.offered_ctc} lakh · ${row.fee_percent}% · joined ${row.actual_joining}`, hsn_sac: '998511', quantity: 1, unit: 'Nos', unit_price: row.fee_amount, tax_percent: S.getSettings().gst_percent }],
      }, adminUser.id);
      const issued = dayAgo(ago - 3);
      finishInvoice(invId, { date: issued, status, due: dueIn === null ? S.addDays(issued, 30) : S.today(dueIn), paidOn: S.addDays(issued, 21) });
      db.prepare('UPDATE pl_offers SET invoice_id = ? WHERE id = ?').run(invId, o.id);
      out.invoices += 1;
    }
    for (const [ci, status] of [[9, 'Paid'], [8, 'Sent']]) {
      const r = contractSvc.invoiceMonth({ month: mA, account_id: clientIds[ci] }, adminUser);
      const issued = S.addDays(`${mA}-${String(dim(mA)).padStart(2, '0')}`, 4);
      finishInvoice(r.invoice_id, { date: issued, status, due: status === 'Paid' ? S.addDays(issued, 30) : S.today(9), paidOn: S.addDays(issued, 24) });
      out.invoices += 1;
    }
    return out;
  })();
}

// ------------------------------- remove -------------------------------------
function clear() {
  return db.transaction(() => {
    const out = {};
    const ids = (sql) => db.prepare(sql).all().map((r) => r.id);
    const jobIds = ids('SELECT id FROM pl_jobs WHERE is_demo = 1');
    const candIds = ids('SELECT id FROM pl_candidates WHERE is_demo = 1');
    const depIds = ids('SELECT id FROM pl_deployed WHERE is_demo = 1');
    const inl = (a) => (a.length ? a.join(',') : '0');
    const pipeIds = ids(`SELECT id FROM pl_pipeline WHERE job_id IN (${inl(jobIds)}) OR candidate_id IN (${inl(candIds)})`);
    const meetIds = ids(`SELECT meeting_id AS id FROM pl_interviews WHERE meeting_id IS NOT NULL AND pipeline_id IN (${inl(pipeIds)})`);
    const invIds = [
      ...ids(`SELECT invoice_id AS id FROM pl_offers WHERE invoice_id IS NOT NULL AND pipeline_id IN (${inl(pipeIds)})`),
      ...ids(`SELECT invoice_id AS id FROM pl_timesheets WHERE invoice_id IS NOT NULL AND deployed_id IN (${inl(depIds)})`),
    ];
    if (meetIds.length) db.prepare(`DELETE FROM meetings WHERE id IN (${inl(meetIds)})`).run();
    if (invIds.length) db.prepare(`DELETE FROM sales_documents WHERE id IN (${inl([...new Set(invIds)])})`).run();
    db.prepare(`DELETE FROM pl_deployed WHERE id IN (${inl(depIds)})`).run();
    db.prepare(`DELETE FROM pl_jobs WHERE id IN (${inl(jobIds)})`).run();
    db.prepare(`DELETE FROM pl_candidates WHERE id IN (${inl(candIds)})`).run();
    const accIds = ids(`SELECT id FROM accounts WHERE tags = '${TAG}'`);
    if (accIds.length) {
      db.prepare(`DELETE FROM contacts WHERE account_id IN (${inl(accIds)})`).run();
      db.prepare(`DELETE FROM meetings WHERE related_module = 'accounts' AND related_record_id IN (${inl(accIds)}) AND meeting_title LIKE 'Interview %'`).run();
      db.prepare(`DELETE FROM pl_client_terms WHERE account_id IN (${inl(accIds)})`).run();
      db.prepare(`DELETE FROM accounts WHERE id IN (${inl(accIds)})`).run();
    }
    db.prepare(`DELETE FROM pl_files WHERE id NOT IN (SELECT resume_file_id FROM pl_candidates WHERE resume_file_id IS NOT NULL) AND id NOT IN (SELECT jd_file_id FROM pl_jobs WHERE jd_file_id IS NOT NULL)`).run();
    // the demo recruiters (nobody can sign in as them) — only when nothing real hangs on them
    const people = ids("SELECT id FROM users WHERE username LIKE 'pl.demo.%'");
    for (const uid of people) {
      const used = Number(db.prepare('SELECT COUNT(*) c FROM pl_pipeline WHERE owner_id = ?').get(uid).c) + Number(db.prepare('SELECT COUNT(*) c FROM pl_candidates WHERE owner_id = ?').get(uid).c);
      if (!used) db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    }
    out.jobs = jobIds.length; out.candidates = candIds.length; out.clients = accIds.length; out.invoices = new Set(invIds).size;
    return out;
  })();
}

module.exports = { load, clear, TAG };
