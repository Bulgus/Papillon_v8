import {
  Evaluation,
  evaluations,
  gradebook,
  gradebookPDF,
  Period as PawnotePeriod,
  SessionHandle,
  TabLocation,
} from "@blockshub/pawnote-lts";

import { Gradebook, SkillEvaluation } from "@/services/shared/evaluation";
import { Period } from "@/services/shared/grade";
import { error } from "@/utils/logger/logger";

type GradeBook = Awaited<ReturnType<typeof gradebook>>;

type Tab = typeof TabLocation.Evaluations | typeof TabLocation.Gradebook;

function tabPeriods(session: SessionHandle, location: Tab): PawnotePeriod[] {
  const tab = session.user?.resources?.[0]?.tabs.get(location);
  if (!tab) {
    throw error(`Tab ${location} not available for this account`, "pronote.tabPeriods");
  }
  return tab.periods;
}

function findPeriod(session: SessionHandle, location: Tab, period: Period): PawnotePeriod {
  const periods = tabPeriods(session, location);
  const found = periods.find(p => p.id === period.id) ?? periods.find(p => p.name === period.name);
  if (!found) {
    throw error(`Period "${period.name}" not found`, "pronote.findPeriod");
  }
  return found;
}

export function mapPronotePeriods(periods: PawnotePeriod[], accountId: string): Period[] {
  return periods.map(p => ({
    id: p.id,
    name: p.name,
    start: p.startDate,
    end: p.endDate,
    createdByAccount: accountId,
  }));
}

export function mapPronoteEvaluation(evaluation: Evaluation, accountId: string): SkillEvaluation {
  return {
    id: evaluation.id,
    name: evaluation.name,
    subject: evaluation.subject?.name ?? "",
    teacher: evaluation.teacher,
    description: evaluation.description,
    date: evaluation.date,
    coefficient: evaluation.coefficient,
    skills: [...evaluation.skills]
      .sort((a, b) => a.order - b.order)
      .map(skill => ({
        id: skill.id,
        name: skill.itemName || skill.domainName,
        domain: skill.itemName ? skill.domainName : skill.pillarName || undefined,
        abbreviation: skill.abbreviation,
        level: skill.level,
        coefficient: skill.coefficient,
        order: skill.order,
      })),
    createdByAccount: accountId,
  };
}

const average = (value: number) => (Number.isFinite(value) && value >= 0 ? value : null);

export function mapPronoteGradebook(book: GradeBook, periodName: string, accountId: string): Gradebook {
  return {
    periodName,
    message: book.message,
    overall: book.overallAssessments.filter(item => item.value?.trim()),
    subjects: book.subjects.map(subject => ({
      name: subject.subject?.name ?? "",
      group: subject.subjectGroup || undefined,
      coefficient: subject.coef,
      studentAverage: average(subject.averages.student),
      classAverage: average(subject.averages.classOverall),
      min: average(subject.averages.min),
      max: average(subject.averages.max),
      appreciation: subject.assessments.filter(Boolean).join("\n"),
      teachers: subject.teachers,
    })),
    createdByAccount: accountId,
  };
}

export async function fetchPronoteEvaluationPeriods(session: SessionHandle, accountId: string): Promise<Period[]> {
  return mapPronotePeriods(tabPeriods(session, TabLocation.Evaluations), accountId);
}

export async function fetchPronoteEvaluations(session: SessionHandle, accountId: string, period: Period): Promise<SkillEvaluation[]> {
  const list = await evaluations(session, findPeriod(session, TabLocation.Evaluations, period));
  return list.map(item => mapPronoteEvaluation(item, accountId)).sort((a, b) => b.date.getTime() - a.date.getTime());
}

export async function fetchPronoteGradebookPeriods(session: SessionHandle, accountId: string): Promise<Period[]> {
  return mapPronotePeriods(tabPeriods(session, TabLocation.Gradebook), accountId);
}

export async function fetchPronoteGradebook(session: SessionHandle, accountId: string, period: Period): Promise<Gradebook> {
  const book = await gradebook(session, findPeriod(session, TabLocation.Gradebook, period));
  return mapPronoteGradebook(book, period.name, accountId);
}

export async function fetchPronoteGradebookPDF(session: SessionHandle, period: Period): Promise<string> {
  return gradebookPDF(session, findPeriod(session, TabLocation.Gradebook, period));
}
