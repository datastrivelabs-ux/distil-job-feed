const SKILLS = [
  'JavaScript','TypeScript','Python','Java','Go','Rust','C++','C#','PHP','Ruby','Scala','Kotlin','Swift','R','MATLAB',
  'React','Vue','Angular','Next.js','Svelte','HTML','CSS','Tailwind','Redux','jQuery',
  'Node.js','Express','NestJS','Django','Flask','FastAPI','Spring Boot','Laravel','Rails','ASP.NET',
  'SQL','PostgreSQL','MySQL','MongoDB','Redis','Elasticsearch','DynamoDB','Cassandra','SQLite','Supabase',
  'AWS','GCP','Azure','Docker','Kubernetes','Terraform','Ansible','CI/CD','Jenkins','GitHub Actions','Linux','Bash',
  'Machine Learning','Deep Learning','TensorFlow','PyTorch','scikit-learn','Pandas','NumPy','Spark','Hadoop',
  'Data Analysis','Power BI','Tableau','Excel','Looker','Databricks','Airflow',
  'Android','iOS','Flutter','React Native','Xamarin',
  'Git','REST APIs','GraphQL','gRPC','Kafka','RabbitMQ','Microservices','System Design','DevOps',
  'Product Management','Agile','Scrum','Jira','Confluence','Stakeholder Management','Project Management',
  'Data Visualization','Statistics','Business Analysis',
  'HR Management','Talent Acquisition','Recruitment','Employee Relations','Payroll',
  'Tally','SAP','ERP','NCS','AUTOCAD','SolidWorks','ANSYS',
  'Financial Modeling','Accounting','Bookkeeping','Auditing','Taxation','CA','CPA',
  'SEO','SEM','Google Analytics','Content Strategy','Social Media','Email Marketing','Copywriting',
  'Sales','CRM','Salesforce','B2B','B2C','Lead Generation','Account Management',
  'Communication','Leadership','Problem Solving','Critical Thinking','Teamwork',
]

export function extractSkillsFromText(text: string): string[] {
  const lower = text.toLowerCase()
  return SKILLS.filter((skill) => {
    const s = skill.toLowerCase()
    const re = new RegExp(`(?<![a-z0-9])${s.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i')
    return re.test(lower)
  })
}
