// 求职数据源 —— AI 找职位时写入 queue；处理完成后移到 applications。
// Dashboard: http://127.0.0.1:8765/

window.JOB_DATA = {
  updatedAt: "2026-09-13",
  queue: [
    {
      id: "q-001",
      company: "Mastercard",
      title: "Software Engineer, Launch Program 2027",
      location: "Toronto, ON",
      salary: "CAD $100,000",
      url: "https://ca.indeed.com/viewjob?jk=9861c503371cc33f",
      notes:
        "来源: Indeed。New Grad · 毕业窗口 Dec 2026–June 2027（你 2027.04 匹配）。申请截止 Oct 6, 2026 23:59 ET。需 Cover Letter + Resume + Transcript。不提供 sponsorship（你有 PGWP 通常可投）。官方也可搜 Workday Campus。",
      addedAt: "2026-09-13",
    },
    {
      id: "q-002",
      company: "Stripe",
      title: "Software Engineer, New Grad",
      location: "Toronto, ON",
      salary: "未在列表页写明",
      url: "https://ca.linkedin.com/jobs/view/software-engineer-new-grad-at-stripe-4461544460",
      notes:
        "来源: LinkedIn。偏 Big Tech，符合偏好。请打开 JD 确认毕业时间/工作授权/薪资后再决定是否处理。",
      addedAt: "2026-09-13",
    },
    {
      id: "q-003",
      company: "Capital One",
      title: "Intern, Full Stack Software Engineer - Team Sprout - Winter 2027",
      location: "Toronto, ON (Hybrid)",
      salary: "CAD $45,000–$85,000（年化区间，实习按期折算）",
      url: "https://ca.indeed.com/viewjob?jk=e5b6436258379fab",
      notes:
        "来源: Indeed。Winter 2027 Co-op · Go/Node/AWS。要求 Bachelor Dec 2026 或之后。简历+非正式成绩单一份 PDF。评估截止曾写 Sep 7, 2026——投前确认是否仍开放。官方: capitalone.wd12.myworkdayjobs.com",
      addedAt: "2026-09-13",
    },
    {
      id: "q-004",
      company: "TD Bank",
      title: "Software Engineer Intern/Co-op (Winter 2027)",
      location: "Toronto, ON",
      salary: "CAD $45,700–$74,400（年化区间）",
      url: "https://ca.indeed.com/viewjob?jk=e1020b0f3501ae56",
      notes:
        "来源: Indeed。Winter 2027 实习/Co-op。打开 JD 确认是否要求实习后继续在读、以及时薪是否 ≥ $25。",
      addedAt: "2026-09-13",
    },
    {
      id: "q-005",
      company: "Amazon",
      title: "Software Development Engineer Intern, ROBOTICS - 2027",
      location: "Toronto, ON",
      salary: "约 CAD $100,810（年化，列表显示）",
      url: "https://ca.indeed.com/viewjob?jk=f040cb67d1169ddf",
      notes:
        "来源: Indeed。Big Tech。常见要求实习结束后仍有在读学期——你 2027.04 毕业，若只能做 Summer 2027 可能不匹配；若可选 Winter/Jan 2027 再认真看。投前务必读 JD 的 student status 条款。",
      addedAt: "2026-09-13",
    },
    {
      id: "q-006",
      company: "IBM",
      title: "Digital Product Engineering - Application Developer Associate (May or September 2027)",
      location: "Toronto, ON",
      salary: "未在列表页写明",
      url: "https://ca.linkedin.com/jobs/view/digital-product-engineering-application-developer-associate-may-or-september-2027-toronto-at-ibm-4458020552",
      notes:
        "来源: LinkedIn。New Grad / Early Career · 2027.05 或 2027.09 入职（毕业后）。打开 JD 确认专业与工作授权要求。",
      addedAt: "2026-09-13",
    },
    {
      id: "q-007",
      company: "Veeva",
      title: "Associate Software Engineer - 2027 Start Dates (EDP)",
      location: "Toronto, ON",
      salary: "CAD $125,000（Cash+RSU）+ $20,000 sign-on",
      url: "https://builtin.com/job/associate-software-engineer-seeking-2027-graduates/10568983",
      notes:
        "来源: 公开招聘页（Indeed/LinkedIn 也可搜同名）。New Grad · 前两年每周 4 天到办公室。不提供 sponsorship。Java/Python/TS/React 相关。建议同时在 LinkedIn/Indeed 搜官方申请入口。",
      addedAt: "2026-09-13",
    },
    {
      id: "q-008",
      company: "Zip",
      title: "Software Engineer, New Grad (2027 Start)",
      location: "Toronto, ON (Hybrid)",
      salary: "CAD $121,000–$126,000",
      url: "https://jobs.ashbyhq.com/zip/b5242472-5679-4084-af77-238b6335b792",
      notes:
        "来源: 官方 Ashby（LinkedIn 常同步）。毕业窗口 Dec 2026–June 2027。栈: Python/TS/React/GraphQL。",
      addedAt: "2026-09-13",
    },
    {
      id: "q-009",
      company: "RBC Borealis",
      title: "Machine Learning Software Engineer (Winter 2027 Student) 4–8 Months",
      location: "Toronto / Vancouver / Calgary",
      salary: "未在列表页写明",
      url: "https://rbc.wd3.myworkdayjobs.com/en-US/RBCEARLYTALENT1/job/TORONTO-Ontario-Canada/XMLNAME-2027-Winter-Student-Opportunities-RBC-Borealis---Machine-Learning-Software-Engineer--4-8-Months_R-0000184499-1",
      notes:
        "来源: RBC Early Talent（LinkedIn/Indeed 常有镜像）。AI/ML Co-op · PyTorch/TF 加分。申请截止约 Sep 20–21, 2026。Montreal 另有 4 个月岗位。",
      addedAt: "2026-09-13",
    },
    {
      id: "q-010",
      company: "Munich Re",
      title: "Software Engineer, Life & Health (2027 Permanent)",
      location: "Toronto, ON",
      salary: "未在列表页写明",
      url: "https://ca.linkedin.com/jobs/view/software-engineer-life-health-2027-permanent-at-munich-re-4466433475",
      notes:
        "来源: LinkedIn。2027 正式岗。请打开 JD 确认是否 New Grad / 经验年限与技术栈是否匹配。",
      addedAt: "2026-09-13",
    },
    {
      id: "q-011",
      company: "BMO Capital Markets",
      title: "Winter 2027 Full Stack Engineer (Co-Op/Internship)",
      location: "Toronto, ON",
      salary: "CAD $50,100–$93,000（年化区间）",
      url: "https://ca.indeed.com/viewjob?jk=849d081321076f3e",
      notes:
        "来源: Indeed。⚠️ JD 写毕业日期 Dec 2027 / 2028 / 2029——你是 2027.04，可能不符合，请人工确认后再处理。截止曾写 Sep 13, 2026。",
      addedAt: "2026-09-13",
    },
  ],
  applications: [],
};
